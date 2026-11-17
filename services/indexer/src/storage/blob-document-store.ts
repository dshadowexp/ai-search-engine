import { hashUrl, type CrawledDocument, type IndexedDocumentReference } from "@search/core";
import {
    loadDocument,
    parseDocumentKey,
    BlobNotFoundError,
    type BlobDocumentStoreOptions,
    type DocumentRef,
    type IndexerBlobDocumentStoreOptions,
    type BlobStore,
} from "@search/infra";
import { gunzip, gzip } from "node:zlib";
import type { IndexDocument } from "../types.ts";

const INDEXED_DOCUMENT_SCHEMA_VERSION = 1;

const gzipAsync = (data: Uint8Array): Promise<Buffer> =>
    new Promise((resolve, reject) => gzip(data, (error, output) => error ? reject(error) : resolve(output)));

const gunzipAsync = (data: Uint8Array, maxOutputLength: number): Promise<Buffer> =>
    new Promise((resolve, reject) =>
        gunzip(data, { maxOutputLength }, (error, output) => error ? reject(error) : resolve(output)),
    );

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const isNonnegativeSafeInteger = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function isIndexDocument(value: unknown): value is IndexDocument {
    if (!isRecord(value)) return false;
    return (
        typeof value.id === "string" &&
        /^[a-f0-9]{64}$/.test(value.id) &&
        typeof value.url === "string" &&
        (value.declaredCanonicalUrl === undefined || typeof value.declaredCanonicalUrl === "string") &&
        typeof value.title === "string" &&
        (typeof value.description === "string" || value.description === null) &&
        typeof value.content === "string" &&
        typeof value.language === "string" &&
        typeof value.contentHash === "string" &&
        /^[a-f0-9]{64}$/.test(value.contentHash) &&
        isNonnegativeSafeInteger(value.version) &&
        value.version > 0 &&
        isNonnegativeSafeInteger(value.fetchedAt) &&
        isNonnegativeSafeInteger(value.createdAt)
    );
}

function parseIndexedDocumentKey(
    key: string,
    keyPrefix: string,
): Pick<IndexedDocumentReference, "key" | "documentId" | "version"> | undefined {
    if (!key.startsWith(keyPrefix)) return undefined;
    const match = /^([a-f0-9]{64})\/v([1-9]\d*)\.json\.gz$/.exec(key.slice(keyPrefix.length));
    if (!match) return undefined;
    const version = Number(match[2]);
    if (!Number.isSafeInteger(version)) return undefined;
    return { key, documentId: match[1]!, version };
}

/** Reads the crawler's queued snapshot, falling back to the current snapshot after cleanup. */
export class CrawledBlobDocumentStore {
    private readonly blobs: Pick<BlobStore, "get" | "close">;
    private readonly keyPrefix: string;
    private readonly maxDocumentBytes: number;

    constructor(options: IndexerBlobDocumentStoreOptions) {
        this.blobs = options.blobs;
        this.keyPrefix = options.keyPrefix ?? "";
        this.maxDocumentBytes = options.maxDocumentBytes ?? 5 * 1024 * 1024;
    }

    async load(ref: DocumentRef | string): Promise<CrawledDocument> {
        try {
            return await loadDocument(this.blobs, ref, this.keyPrefix, this.maxDocumentBytes);
        } catch (error) {
            if (!(error instanceof BlobNotFoundError)) throw error;

            const parsedKey = parseDocumentKey(typeof ref === "string" ? ref : ref.key, this.keyPrefix);
            if (!parsedKey || parsedKey.fetchedAt === undefined) throw error;

            const currentKey = `${this.keyPrefix}${parsedKey.documentId}.json.gz`;
            return loadDocument(this.blobs, currentKey, this.keyPrefix, this.maxDocumentBytes);
        }
    }

    async close(): Promise<void> {
        await this.blobs.close();
    }
}

export interface IndexedBlobDocumentStoreOptions extends BlobDocumentStoreOptions {
    blobs: Pick<BlobStore, "put" | "get" | "close">;
}

export class IndexedBlobDocumentStore {
    private readonly blobs: Pick<BlobStore, "put" | "get" | "close">;
    private readonly keyPrefix: string;
    private readonly maxDocumentBytes: number;

    constructor(options: IndexedBlobDocumentStoreOptions) {
        this.blobs = options.blobs;
        const keyPrefix = options.keyPrefix ?? "indexed-documents/";
        this.keyPrefix = keyPrefix && !keyPrefix.endsWith("/") ? `${keyPrefix}/` : keyPrefix;
        this.maxDocumentBytes = options.maxDocumentBytes ?? 5 * 1024 * 1024;
        if (!Number.isSafeInteger(this.maxDocumentBytes) || this.maxDocumentBytes < 1) {
            throw new RangeError("maxDocumentBytes must be a positive safe integer");
        }
    }

    /** Stores each normalized version at an immutable, deterministic key. */
    async saveVersion(
        document: IndexDocument,
        options: { signal?: AbortSignal } = {},
    ): Promise<IndexedDocumentReference> {
        if (!isIndexDocument(document) || hashUrl(document.url) !== document.id) {
            throw new TypeError("document is not a valid IndexDocument");
        }

        const serialized = Buffer.from(JSON.stringify({
            schemaVersion: INDEXED_DOCUMENT_SCHEMA_VERSION,
            document,
        }));
        if (serialized.byteLength > this.maxDocumentBytes) {
            throw new RangeError(`indexed document ${document.id}@${document.version} exceeds ${this.maxDocumentBytes} bytes`);
        }

        const key = `${this.keyPrefix}${document.id}/v${document.version}.json.gz`;
        const body = await gzipAsync(serialized);
        await this.blobs.put(key, body, {
            contentType: "application/gzip",
            metadata: {
                "schema-version": String(INDEXED_DOCUMENT_SCHEMA_VERSION),
                "document-id": document.id,
                "document-version": String(document.version),
                "content-hash": document.contentHash,
            },
            ...(options.signal ? { signal: options.signal } : {}),
        });

        return {
            key,
            documentId: document.id,
            version: document.version,
            contentHash: document.contentHash,
        };
    }

    async load(reference: IndexedDocumentReference | string): Promise<IndexDocument> {
        const key = typeof reference === "string" ? reference : reference.key;
        const parsedKey = parseIndexedDocumentKey(key, this.keyPrefix);
        if (!parsedKey) throw new TypeError(`not an indexed document key: ${key}`);
        if (
            typeof reference !== "string" &&
            (reference.documentId !== parsedKey.documentId || reference.version !== parsedKey.version)
        ) {
            throw new TypeError(`indexed document reference ${key} does not match its key`);
        }

        const { body } = await this.blobs.get(key, { maxBytes: this.maxDocumentBytes });
        let envelope: unknown;
        try {
            envelope = JSON.parse((await gunzipAsync(body, this.maxDocumentBytes)).toString("utf8"));
        } catch (cause) {
            throw new Error(`indexed document ${key} is corrupt or exceeds the size limit`, { cause });
        }

        if (
            !isRecord(envelope) ||
            envelope.schemaVersion !== INDEXED_DOCUMENT_SCHEMA_VERSION ||
            !isIndexDocument(envelope.document)
        ) {
            throw new TypeError(`indexed document ${key} has an invalid envelope or document`);
        }

        const document = envelope.document;
        if (
            document.id !== parsedKey.documentId ||
            document.version !== parsedKey.version ||
            (typeof reference !== "string" && document.contentHash !== reference.contentHash) ||
            hashUrl(document.url) !== document.id
        ) {
            throw new TypeError(`indexed document ${key} does not match its reference`);
        }
        return document;
    }

    async close(): Promise<void> {
        await this.blobs.close();
    }
}