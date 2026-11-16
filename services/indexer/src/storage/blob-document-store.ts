import { CrawledDocument } from "@search/core";
import {
    DEFAULT_KEY_PREFIX,
    loadDocument,
    parseDocumentKey,
    BlobNotFoundError,
    type DocumentRef,
    type IndexerBlobDocumentStoreOptions,
    type BlobStore
} from "@search/infra";

/** Indexer-facing read-only access to a queued snapshot, falling back to the current snapshot after cleanup. */
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