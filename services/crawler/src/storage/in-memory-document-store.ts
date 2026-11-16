import type { CrawledDocument } from "@search/core";
import type { DocumentStore, SavedDocument } from "@search/infra";

export class InMemoryDocumentStore implements DocumentStore<CrawledDocument, SavedDocument> {
    private readonly docs = new Map<string, CrawledDocument>();

    get size(): number {
        return this.docs.size;
    }

    async save(document: CrawledDocument): Promise<SavedDocument> {
        this.docs.set(document.url, document);
        
        return {
            key: document.url,
            documentId: document.contentHash,
            fetchedAt: 0,
            created: true,
            storedBytes: 12345
        }
    }

    async get(url: string): Promise<CrawledDocument | undefined> {
        return this.docs.get(url);
    }

    all(): IterableIterator<CrawledDocument> {
        return this.docs.values();
    }
}