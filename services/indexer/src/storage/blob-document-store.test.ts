import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashUrl } from "@search/core";
import type { BlobStore } from "@search/infra";
import { IndexedBlobDocumentStore } from "./blob-document-store.ts";
import type { IndexDocument } from "../types.ts";

describe("IndexedBlobDocumentStore", () => {
    it("round-trips normalized documents using distinct versioned keys", async () => {
        const objects = new Map<string, Uint8Array>();
        const blobs: Pick<BlobStore, "put" | "get" | "close"> = {
            async put(key, body) {
                objects.set(key, Buffer.from(body));
                return { created: true };
            },
            async get(key) {
                const body = objects.get(key);
                if (!body) throw new Error(`missing object: ${key}`);
                return { body, metadata: { key, size: body.byteLength } };
            },
            async close() {},
        };
        const store = new IndexedBlobDocumentStore({ blobs });
        const url = "https://example.com/article";
        const first: IndexDocument = {
            id: hashUrl(url),
            url,
            title: "First version",
            description: null,
            content: "first content",
            language: "en",
            contentHash: "a".repeat(64),
            version: 1,
            fetchedAt: 1,
            createdAt: 1,
        };
        const second: IndexDocument = {
            ...first,
            title: "Second version",
            content: "second content",
            contentHash: "b".repeat(64),
            version: 2,
            fetchedAt: 2,
            createdAt: 2,
        };

        const firstRef = await store.saveVersion(first);
        const secondRef = await store.saveVersion(second);

        assert.notEqual(firstRef.key, secondRef.key);
        assert.deepEqual(await store.load(firstRef), first);
        assert.deepEqual(await store.load(secondRef.key), second);
        await assert.rejects(
            store.load({ ...firstRef, contentHash: "c".repeat(64) }),
            /does not match its reference/,
        );
    });
});
