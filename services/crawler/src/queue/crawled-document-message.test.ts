import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crawledDocumentMessageSchema, createCrawledDocumentMessage } from "./crawled-document-message.ts";


describe("queue message schemas", () => {
    it("creates a stable persisted-document event from a blob reference", () => {
        const document = {
            key: `documents/${"a".repeat(64)}.json.gz`,
            documentId: "a".repeat(64),
            fetchedAt: 1,
        };
        
        const first = createCrawledDocumentMessage(document);
        const second = createCrawledDocumentMessage(document);
        const nextFetch = createCrawledDocumentMessage({ ...document, fetchedAt: 2 });

        assert.equal(first.eventType, "crawler.document.persisted");
        assert.equal(first.eventId, second.eventId);
        assert.notEqual(first.eventId, nextFetch.eventId);
        assert.deepEqual(crawledDocumentMessageSchema.parse(first), first);
        assert.throws(() => crawledDocumentMessageSchema.parse({ ...first, unsupported: true }));
    });
});

