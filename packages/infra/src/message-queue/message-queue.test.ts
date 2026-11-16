import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { crawledDocumentMessageSchema, createCrawledDocumentMessage } from "./crawled-document-message.ts";
import { decodeQueueMessage, encodeQueueMessage } from "./message-queue.ts";
import { SqsMessageQueue } from "./sqs-message-queue.ts";

describe("queue message schemas", () => {
    it("round-trips validated JSON and rejects malformed payloads", () => {
        const schema = z.object({ documentId: z.string() }).strict();
        const encoded = encodeQueueMessage({ documentId: "doc-1" }, schema);

        assert.deepEqual(decodeQueueMessage(encoded.body, schema), encoded.message);
        assert.throws(() => decodeQueueMessage('{"documentId":4}', schema));
        assert.throws(() => decodeQueueMessage("{", schema));
    });

    it("creates a stable persisted-document event from a blob reference", () => {
        const document = {
            key: `documents/${"a".repeat(64)}/000000000000001-${"b".repeat(16)}.json.gz`,
            documentId: "a".repeat(64),
            fetchedAt: 1,
        };
        const first = createCrawledDocumentMessage(document);
        const second = createCrawledDocumentMessage(document);

        assert.equal(first.eventType, "crawler.document.persisted");
        assert.equal(first.eventId, second.eventId);
        assert.deepEqual(crawledDocumentMessageSchema.parse(first), first);
        assert.throws(() => crawledDocumentMessageSchema.parse({ ...first, unsupported: true }));
    });
});

describe("SQS queue options", () => {
    const schema = z.object({ documentId: z.string() });

    it("requires a message group for FIFO queues", () => {
        assert.throws(
            () => new SqsMessageQueue("https://sqs.us-east-1.amazonaws.com/123/events.fifo", { schema }),
            /FIFO queues require messageGroupId/,
        );
    });

    it("validates batch size before starting workers", () => {
        const queue = new SqsMessageQueue("https://sqs.us-east-1.amazonaws.com/123/events", { schema });
        assert.throws(() => queue.consume(async () => {}, { batchSize: 11 }), /batchSize/);
    });
});
