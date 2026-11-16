import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CrawledDocument } from "@search/core";
import type { BlobStore } from "./blob-store.ts";
import { CrawlerBlobDocumentStore } from "./crawler-blob-document-store.ts";
import { IndexerBlobDocumentStore } from "./indexer-blob-document-store.ts";

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

function createBlobStore(): Pick<BlobStore, "put" | "get" | "list" | "close"> {
    const objects = new Map<string, Uint8Array>();
    return {
        async put(key, body, options = {}) {
            if (options.ifNotExists && objects.has(key)) return { created: false };
            const bytes = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
            objects.set(key, bytes);
            return { created: true };
        },
        async get(key, options = {}) {
            const body = objects.get(key);
            if (!body) throw new Error(`Missing blob: ${key}`);
            if (options.maxBytes !== undefined && body.byteLength > options.maxBytes) {
                throw new Error("Blob exceeds maxBytes");
            }
            return { body, metadata: { key, size: body.byteLength } };
        },
        async list(prefix) {
            return {
                items: [...objects.entries()]
                    .filter(([key]) => key.startsWith(prefix))
                    .map(([key, body]) => ({ key, size: body.byteLength })),
            };
        },
        async close() {},
    };
}

describe("role-specific blob document stores", () => {
    it("lets the crawler persist a version that the indexer loads by reference", async () => {
        const blobs = createBlobStore();
        const crawlerDocuments = new CrawlerBlobDocumentStore({ blobs });
        const indexerDocuments = new IndexerBlobDocumentStore({ blobs });

        const reference = await crawlerDocuments.saveVersion(document);
        assert.deepEqual(await indexerDocuments.load(reference), document);
    });

    it("rejects a reference whose metadata does not match its key", async () => {
        const blobs = createBlobStore();
        const crawlerDocuments = new CrawlerBlobDocumentStore({ blobs });
        const indexerDocuments = new IndexerBlobDocumentStore({ blobs });
        const reference = await crawlerDocuments.saveVersion(document);

        await assert.rejects(
            indexerDocuments.load({ ...reference, documentId: "a".repeat(64) }),
            /does not match its key/,
        );
    });
});
