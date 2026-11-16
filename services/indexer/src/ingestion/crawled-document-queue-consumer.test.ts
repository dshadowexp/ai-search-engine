import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashUrl, type CrawledDocument } from "@search/core";
import type { CrawledDocumentMessage } from "../../../../packages/infra/src/message-queue/crawled-document-message.ts";
import type { MessageQueueConsumer } from "../../../../packages/infra/src/message-queue/message-queue.ts";
import type { DocumentIngestor } from "./document-ingestor.ts";
import { CrawledDocumentQueueConsumer } from "./crawled-document-queue-consumer.ts";

const document: CrawledDocument = {
    url: "https://example.com/article",
    title: "Article",
    description: null,
    headings: [],
    textContent: "Article content",
    contentHash: "content-hash",
    language: "en",
    publishedAt: null,
    modifiedAt: null,
    links: [],
    fetchedAt: 1,
    depth: 0,
    truncated: false,
};

const documentId = hashUrl(document.url);
const reference = {
    key: `documents/${documentId}.json.gz`,
    documentId,
    fetchedAt: 1,
};

describe("CrawledDocumentQueueConsumer", () => {
    it("loads the referenced blob and ingests it in the queue handler", async () => {
        let handler: ((message: CrawledDocumentMessage) => Promise<void>) | undefined;
        const queue: MessageQueueConsumer<CrawledDocumentMessage> = {
            consume: (next) => {
                handler = next;
                return { stop: async () => {} };
            },
        };
        let loadedReference: unknown;
        const documents = {
            load: async (ref: typeof reference) => {
                loadedReference = ref;
                return document;
            },
        };
        const ingested: CrawledDocument[] = [];
        const ingestor: Pick<DocumentIngestor, "ingest"> = {
            ingest: async (value) => {
                ingested.push(value);
                return { status: "created" };
            },
        };
        const consumer = new CrawledDocumentQueueConsumer(queue, documents, ingestor);
        const subscription = consumer.start();

        assert.ok(handler);
        await handler({
            schemaVersion: 1,
            eventType: "crawler.document.persisted",
            eventId: "stable-event-id",
            document: reference,
        });
        await subscription.stop();

        assert.deepEqual(loadedReference, reference);
        assert.deepEqual(ingested, [document]);
    });
});
