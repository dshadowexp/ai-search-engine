import type { CrawledDocument } from "@search/core";
import type { DocumentStore } from "./document-store.ts";
import {
    DEFAULT_KEY_PREFIX,
    loadDocument,
    listDocumentVersions,
    saveDocumentVersion,
    type CrawlerBlobDocumentStoreOptions,
    type DocumentRef,
    type SavedDocument,
} from "./blob-document-store.ts";
import type { BlobStore } from "./blob-store.ts";

/** Crawler-facing persistence operations. */
export class CrawlerBlobDocumentStore implements DocumentStore {
    private readonly blobs: Pick<BlobStore, "put" | "get" | "list" | "close">;
    private readonly keyPrefix: string;
    private readonly maxDocumentBytes: number;

    constructor(options: CrawlerBlobDocumentStoreOptions) {
        this.blobs = options.blobs;
        this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
        this.maxDocumentBytes = options.maxDocumentBytes ?? 5 * 1024 * 1024;
    }

    /** Idempotent: a retry of the same crawl produces the same key. */
    async save(document: CrawledDocument): Promise<void> {
        await this.saveVersion(document);
    }

    async saveVersion(document: CrawledDocument, options: { signal?: AbortSignal } = {}): Promise<SavedDocument> {
        return saveDocumentVersion(this.blobs, document, this.keyPrefix, this.maxDocumentBytes, options);
    }

    async get(url: string): Promise<CrawledDocument | undefined> {
        const versions = await this.listVersions(url);
        const latest = versions.at(-1);
        return latest ? loadDocument(this.blobs, latest, this.keyPrefix, this.maxDocumentBytes) : undefined;
    }

    /** Every stored crawl of `url`, oldest first. */
    async listVersions(url: string): Promise<DocumentRef[]> {
        return listDocumentVersions(this.blobs, url, this.keyPrefix);
    }

    async close(): Promise<void> {
        await this.blobs.close();
    }
}
