import {
    DEFAULT_KEY_PREFIX,
    loadDocument,
    type DocumentRef,
    type IndexerBlobDocumentStoreOptions,
} from "./blob-document-store.ts";
import type { BlobStore } from "./blob-store.ts";
import type { CrawledDocument } from "@search/core";

/** Indexer-facing read-only access to the exact crawl version announced by the queue. */
export class IndexerBlobDocumentStore {
    private readonly blobs: Pick<BlobStore, "get" | "close">;
    private readonly keyPrefix: string;
    private readonly maxDocumentBytes: number;

    constructor(options: IndexerBlobDocumentStoreOptions) {
        this.blobs = options.blobs;
        this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
        this.maxDocumentBytes = options.maxDocumentBytes ?? 5 * 1024 * 1024;
    }

    async load(ref: DocumentRef | string): Promise<CrawledDocument> {
        return loadDocument(this.blobs, ref, this.keyPrefix, this.maxDocumentBytes);
    }

    async close(): Promise<void> {
        await this.blobs.close();
    }
}
