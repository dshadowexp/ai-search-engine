import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashUrl, type CrawledDocument } from "@search/core";
import type { CrawledDocumentMessage } from "../message-queue/crawled-document-message.ts";
import type { MessageQueueProducer } from "../message-queue/message-queue.ts";
import { QueueingDocumentStore } from "./queueing-document-store.ts";

const crawledDocument: CrawledDocument = {
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

const documentId = hashUrl(crawledDocument.url);
const reference = {
    key: `documents/${documentId}/000000000000001-${"b".repeat(16)}.json.gz`,
    documentId,
    fetchedAt: 1,
};

describe("QueueingDocumentStore", () => {
    it("publishes the stable reference only after blob persistence succeeds", async () => {
        const order: string[] = [];
        let published: CrawledDocumentMessage | undefined;
        const producer: MessageQueueProducer<CrawledDocumentMessage> = {
            publish: async (message) => {
                order.push("publish");
                published = message;
            },
        };
        const documents = {
            saveVersion: async (document: CrawledDocument) => {
                assert.equal(document, crawledDocument);
                order.push("save");
                return { ...reference, created: true, storedBytes: 32 };
            },
            get: async () => undefined,
        };
        const store = new QueueingDocumentStore(documents, producer);

        await store.save(crawledDocument);

        assert.deepEqual(order, ["save", "publish"]);
        assert.equal(published?.document.key, reference.key);
        assert.equal(published?.eventId.length, 64);
    });

    it("propagates publish failure so the crawler can retry the save", async () => {
        const store = new QueueingDocumentStore(
            {
                saveVersion: async () => ({ ...reference, created: true, storedBytes: 32 }),
                get: async () => undefined,
            },
            { publish: async () => { throw new Error("queue unavailable"); } },
        );

        await assert.rejects(store.save(crawledDocument), /queue unavailable/);
    });
});
