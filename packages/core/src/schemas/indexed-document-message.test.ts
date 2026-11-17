import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    createIndexedDocumentMessage,
    indexedDocumentMessageSchema,
} from "./indexed-document-message.ts";

describe("indexed document queue message", () => {
    it("creates a stable reference event for a document version", () => {
        const document = {
            key: `indexed-documents/${"a".repeat(64)}/v2.json.gz`,
            documentId: "a".repeat(64),
            version: 2,
            contentHash: "b".repeat(64),
        };

        const first = createIndexedDocumentMessage(document);
        const second = createIndexedDocumentMessage(document);

        assert.equal(first.eventType, "indexer.document.ready_for_semantic_index");
        assert.equal(first.eventId, second.eventId);
        assert.deepEqual(indexedDocumentMessageSchema.parse(first), first);
        assert.throws(() =>
            indexedDocumentMessageSchema.parse({ ...first, document: { ...document, version: 0 } }),
        );
    });
});
