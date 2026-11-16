import type { CrawledDocument } from "@search/core";
import {
    createCrawledDocumentMessage,
    type CrawledDocumentMessage,
} from "../message-queue/crawled-document-message.ts";
import type { MessageQueueProducer } from "../message-queue/message-queue.ts";
import type { CrawlerBlobDocuments } from "./blob-document-store.ts";
import type { DocumentStore } from "./document-store.ts";

/** Persists each crawl, then publishes its small, idempotent blob-reference event. */
export class QueueingDocumentStore implements DocumentStore {
    private readonly documents: CrawlerBlobDocuments;
    private readonly producer: MessageQueueProducer<CrawledDocumentMessage>;

    constructor(
        documents: CrawlerBlobDocuments,
        producer: MessageQueueProducer<CrawledDocumentMessage>,
    ) {
        this.documents = documents;
        this.producer = producer;
    }

    async save(document: CrawledDocument): Promise<void> {
        const reference = await this.documents.saveVersion(document);
        await this.producer.publish(createCrawledDocumentMessage(reference));
    }

    get(url: string): Promise<CrawledDocument | undefined> {
        return this.documents.get(url);
    }
}
