import type { CrawledDocument } from "@search/core";


/**
 * Where crawled documents go. save() MUST be idempotent (keyed by document.url): a crash
 * between save() and acknowledge() means the URL is crawled again and saved again.
 */
export interface DocumentStore {
    save(document: CrawledDocument, key?: string | undefined): Promise<void>;
    get(url: string): Promise<CrawledDocument | undefined>;
}

export class InMemoryDocumentStore implements DocumentStore {
    private readonly docs = new Map<string, CrawledDocument>();

    get size(): number {
      return this.docs.size;
    }

    async save(document: CrawledDocument): Promise<void> {
      this.docs.set(document.url, document);
    }

    async get(url: string): Promise<CrawledDocument | undefined> {
      return this.docs.get(url);
    }

    all(): IterableIterator<CrawledDocument> {
      return this.docs.values();
    }
}