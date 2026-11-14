import type { CrawledDocument } from "@search/types";
import type { DocumentStore } from "@search/shared";
import type { DocumentIngestor } from "./document-ingestor.ts";

/**
 * The crawler's only coupling to indexing. Plug it in as the crawler's DocumentStore:
 *   crawler -> save() -> [raw store] + [ingest: version + durable job] -> (async) index workers
 * The crawler never waits for tokenization or embeddings. If ingestion throws, the crawler's worker
 * reports a retryable failure and the URL is crawled again (ingestion is idempotent by content hash).
 */
export class IngestingDocumentStore implements DocumentStore {
    constructor(
        private readonly inner: DocumentStore,
        private readonly ingestor: DocumentIngestor,
    ) {}

    async save(document: CrawledDocument): Promise<void> {
        await this.inner.save(document);
        await this.ingestor.ingest(document); // "rejected" is a verdict, not an error: retrying can't change it
    }

    get(url: string): Promise<CrawledDocument | undefined> {
        return this.inner.get(url);
    }
}
