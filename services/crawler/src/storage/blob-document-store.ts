import type { CrawledDocument } from "@search/core";
import { 
    saveDocumentVersion, 
    loadDocument,
    listDocumentVersions,
    type BlobDocumentStoreOptions, 
    type BlobStore, 
    type DocumentStore, 
    type DocumentRef,
    type SavedDocument
} from "@search/infra";

export interface CrawledBlobDocumentStoreOptions extends BlobDocumentStoreOptions {
    blobs: Pick<BlobStore, "put" | "get" | "list" | "delete" | "close">;
}

/** Crawler-facing persistence operations. */
export class CrawledBlobDocumentStore implements DocumentStore<CrawledDocument, SavedDocument> {
    private readonly blobs: Pick<BlobStore, "put" | "get" | "list" | "delete" | "close">;
    private readonly keyPrefix: string;
    private readonly maxDocumentBytes: number;

    constructor(options: CrawledBlobDocumentStoreOptions) {
        this.blobs = options.blobs;
        this.keyPrefix = options.keyPrefix ?? "";
        this.maxDocumentBytes = options.maxDocumentBytes ?? 5 * 1024 * 1024;
    }

    /** Idempotent: a retry of the same crawl produces the same key. */
    async save(document: CrawledDocument): Promise<SavedDocument> {
        return await this.saveVersion(document);
    }

    async saveVersion(document: CrawledDocument, options: { signal?: AbortSignal } = {}): Promise<SavedDocument> {
        return saveDocumentVersion<CrawledDocument>(this.blobs, document, this.keyPrefix, this.maxDocumentBytes, options);
    }

    async get(url: string): Promise<CrawledDocument | undefined> {
        const versions = await this.listVersions(url);
        const latest = versions.at(-1);
        return latest ? loadDocument(this.blobs, latest, this.keyPrefix, this.maxDocumentBytes) : undefined;
    }

    /** The current snapshot for `url`, if one has been stored. */
    async listVersions(url: string): Promise<DocumentRef[]> {
        return listDocumentVersions(this.blobs, url, this.keyPrefix, this.maxDocumentBytes);
    }

    async close(): Promise<void> {
        await this.blobs.close();
    }
}
