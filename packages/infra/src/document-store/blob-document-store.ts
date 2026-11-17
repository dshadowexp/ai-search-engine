import { gunzip, gzip } from "node:zlib";
import { z } from "zod";
import { crawledDocumentSchema, hashUrl } from "@search/core";
import type { CrawledDocument } from "@search/core";
import type { BlobStore } from "./blob-store.ts";
import { invalid } from "../errors.ts";

export const DOCUMENT_SCHEMA_VERSION = 1;

export interface BlobDocumentStoreOptions {
    keyPrefix?: string;
    /** Upper bound on a document's serialized size, enforced on write AND on decompressed read. Default 5 MiB. */
    maxDocumentBytes?: number;
}

export interface CrawlerBlobDocumentStoreOptions extends BlobDocumentStoreOptions {
    blobs: Pick<BlobStore, "put" | "get" | "list" | "delete" | "close">;
}

export interface IndexerBlobDocumentStoreOptions extends BlobDocumentStoreOptions {
    blobs: Pick<BlobStore, "get" | "close">;
}

export interface DocumentRef {
    key: string;
    documentId: string;
    fetchedAt: number;
}

export interface SavedDocument extends DocumentRef {
    /** False when this URL already had a snapshot at the time of the write. */
    created: boolean;
    storedBytes: number;
}

export interface CrawlerBlobDocuments {
    get(url: string): Promise<CrawledDocument | undefined>;
    saveVersion(document: CrawledDocument, options?: { signal?: AbortSignal }): Promise<SavedDocument>;
}

export interface IndexerBlobDocuments {
    load(ref: DocumentRef | string): Promise<CrawledDocument>;
}

type ParsedDocumentKey = Pick<DocumentRef, "key" | "documentId"> & { fetchedAt?: number };

const envelopeSchema = z.object({
    schemaVersion: z.literal(DOCUMENT_SCHEMA_VERSION),
    document: crawledDocumentSchema,
});

const gzipAsync = (data: Uint8Array): Promise<Buffer> =>
    new Promise((resolve, reject) => gzip(data, (error, output) => error ? reject(error) : resolve(output)));

const gunzipAsync = (data: Uint8Array, maxOutputLength: number): Promise<Buffer> =>
    new Promise((resolve, reject) =>
        gunzip(data, { maxOutputLength }, (error, output) => error ? reject(error) : resolve(output)),
    );

/** A stable key per URL, so each successful crawl replaces that URL's current snapshot. */
export function documentKey(
    url: string,
    keyPrefix = "",
): string {
    return `${keyPrefix}${hashUrl(url)}.json.gz`;
}

/** Parses current and legacy keys; undefined for malformed keys from untrusted events. */
export function parseDocumentKey(
    key: string,
    keyPrefix = "",
): ParsedDocumentKey | undefined {
    if (!key.startsWith(keyPrefix)) return undefined;
    const relativeKey = key.slice(keyPrefix.length);
    const currentMatch = /^([0-9a-f]{64})\.json\.gz$/.exec(relativeKey);
    if (currentMatch) return { key, documentId: currentMatch[1] };

    const legacyMatch = /^([0-9a-f]{64})\/(\d{15})-[0-9a-f]{16}\.json\.gz$/.exec(relativeKey);
    return legacyMatch
        ? { key, documentId: legacyMatch[1], fetchedAt: Number(legacyMatch[2]) }
        : undefined;
}

export async function saveDocumentVersion(
    blobs: Pick<BlobStore, "put" | "list" | "delete">,
    document: CrawledDocument,
    keyPrefix: string,
    maxDocumentBytes: number,
    options: { signal?: AbortSignal } = {},
): Promise<SavedDocument> {
    const parsed = crawledDocumentSchema.safeParse(document);
    if (!parsed.success) {
        throw invalid(`invalid document: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ")}`);
    }

    const doc = parsed.data;
    if (!/^https?:\/\//.test(doc.url)) {
        throw invalid(`document url must be absolute http(s): ${doc.url}`);
    }

    const json = JSON.stringify({ schemaVersion: DOCUMENT_SCHEMA_VERSION, document: doc });
    if (Buffer.byteLength(json) > maxDocumentBytes) {
        throw invalid(`document ${doc.url} exceeds ${maxDocumentBytes} bytes`);
    }

    const documentId = hashUrl(doc.url);
    const key = documentKey(doc.url, keyPrefix);
    const body = await gzipAsync(Buffer.from(json));
    const existing = await blobs.list(key, { limit: 1000 });
    const put = await blobs.put(key, body, {
        contentType: "application/gzip",
        metadata: { "schema-version": String(DOCUMENT_SCHEMA_VERSION), "document-id": documentId },
        ...(options.signal ? { signal: options.signal } : {}),
    });

    const existed = existing.items.some((item) => item.key === key);
    await removeLegacyDocumentVersions(blobs, documentId, keyPrefix, options);
    return { key, documentId, fetchedAt: doc.fetchedAt, created: !existed && put.created, storedBytes: body.byteLength };
}

async function removeLegacyDocumentVersions(
    blobs: Pick<BlobStore, "list" | "delete">,
    documentId: string,
    keyPrefix: string,
    options: { signal?: AbortSignal },
): Promise<void> {
    let token: string | undefined;
    do {
        const page = await blobs.list(`${keyPrefix}${documentId}/`, {
            limit: 1000,
            ...(token ? { token } : {}),
            ...(options.signal ? { signal: options.signal } : {}),
        });
        for (const item of page.items) {
            if (parseDocumentKey(item.key, keyPrefix)?.documentId === documentId) {
                await blobs.delete(item.key, options.signal ? { signal: options.signal } : {});
            }
        }
        token = page.nextToken;
    } while (token);
}

export async function listDocumentVersions(
    blobs: Pick<BlobStore, "get" | "list">,
    url: string,
    keyPrefix: string,
    maxDocumentBytes: number,
): Promise<DocumentRef[]> {
    const prefix = `${keyPrefix}${hashUrl(url)}`;
    const refs: DocumentRef[] = [];
    let token: string | undefined;
    do {
        const page = await blobs.list(prefix, { limit: 1000, ...(token ? { token } : {}) });
        for (const item of page.items) {
            const parsedKey = parseDocumentKey(item.key, keyPrefix);
            if (!parsedKey) continue;

            const fetchedAt = parsedKey.fetchedAt ??
                (await loadDocument(blobs, item.key, keyPrefix, maxDocumentBytes)).fetchedAt;
            refs.push({ key: item.key, documentId: parsedKey.documentId, fetchedAt });
        }
        token = page.nextToken;
    } while (token);
    return refs.sort((left, right) => left.fetchedAt - right.fetchedAt || left.key.localeCompare(right.key));
}

export async function loadDocument(
    blobs: Pick<BlobStore, "get">,
    ref: DocumentRef | string,
    keyPrefix: string,
    maxDocumentBytes: number,
): Promise<CrawledDocument> {
    const key = typeof ref === "string" ? ref : ref.key;
    const parsedKey = parseDocumentKey(key, keyPrefix);
    if (!parsedKey) {
        throw invalid(`not a document key: ${key}`);
    }
    if (typeof ref !== "string" &&
        (ref.documentId !== parsedKey.documentId ||
            (parsedKey.fetchedAt !== undefined && ref.fetchedAt !== parsedKey.fetchedAt))) {
        throw invalid(`document reference ${key} does not match its key`);
    }

    const { body } = await blobs.get(key, { maxBytes: maxDocumentBytes });
    let raw: unknown;
    try {
        raw = JSON.parse((await gunzipAsync(body, maxDocumentBytes)).toString("utf8"));
    } catch {
        throw invalid(`document ${key} is corrupt (not gzip/JSON) or larger than ${maxDocumentBytes} bytes decompressed`);
    }

    const parsed = envelopeSchema.safeParse(raw);
    if (!parsed.success) {
        const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
        if (typeof version === "number" && version !== DOCUMENT_SCHEMA_VERSION) {
            throw invalid(`document ${key} has unsupported schema version ${version}`);
        }
        throw invalid(`document ${key} failed validation: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
    }

    const document = parsed.data.document;
    if (hashUrl(document.url) !== parsedKey.documentId ||
        (parsedKey.fetchedAt !== undefined && document.fetchedAt !== parsedKey.fetchedAt)) {
        throw invalid(`document ${key} does not belong at this key (URL/fetchedAt mismatch)`);
    }
    return document;
}
