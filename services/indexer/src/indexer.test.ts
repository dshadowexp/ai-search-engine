import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashUrl } from "@search/core";
import { crawled } from "./helpers.test.ts";
import { createIndexingPipeline } from "./setup.ts";

describe("lexical-only indexing pipeline", () => {
    it("creates lexical-only jobs and publishes indexed documents", async () => {
        const indexing = createIndexingPipeline();
        const ingestion = await indexing.ingestor.ingest(crawled("https://example.com/a", "searchable phrase", 1));

        assert.equal(ingestion.status, "created");
        const documentId = hashUrl("https://example.com/a");
        const job = await indexing.jobs.get(documentId, 1);
        assert.deepEqual(Object.keys(job!.stages), ["lexical"]);

        indexing.pipeline.start();
        try {
            await indexing.pipeline.waitUntilIdle({ pollMs: 1 });
        } finally {
            await indexing.pipeline.stop();
        }

        assert.equal((await indexing.documents.get(documentId))?.activeVersion, 1);
        assert.equal((await indexing.lexical.getPostings("searchable")).length, 1);
        assert.equal((await indexing.jobs.get(documentId, 1))?.stages.lexical.published, true);
    });

    it("searches documents through the search service wired to the lexical index", async () => {
        const indexing = createIndexingPipeline();
        await indexing.ingestor.ingest(crawled("https://example.com/search", "distinctive searchable phrase", 1));

        indexing.pipeline.start();
        try {
            await indexing.pipeline.waitUntilIdle({ pollMs: 1 });
        } finally {
            await indexing.pipeline.stop();
        }

        const response = await indexing.searchService.search("searchable");
        assert.equal(response.strategy, "lexical");
        assert.equal(response.hits.length, 1);
        assert.equal(response.hits[0].url, "https://example.com/search");
        assert.match(response.hits[0].snippet, /searchable/);
    });

    it("replaces old lexical versions when a newer document version is published", async () => {
        const indexing = createIndexingPipeline();
        const documentId = hashUrl("https://example.com/a");

        await indexing.ingestor.ingest(crawled("https://example.com/a", "oldword", 1));
        indexing.pipeline.start();
        try {
            await indexing.pipeline.waitUntilIdle({ pollMs: 1 });
            await indexing.ingestor.ingest(crawled("https://example.com/a", "newword", 2));
            await indexing.pipeline.waitUntilIdle({ pollMs: 1 });
        } finally {
            await indexing.pipeline.stop();
        }

        assert.equal((await indexing.documents.get(documentId))?.activeVersion, 2);
        assert.equal((await indexing.documents.getVersion(documentId, 1)), undefined);
        assert.equal((await indexing.lexical.getPostings("oldword")).length, 0);
        assert.equal((await indexing.lexical.getPostings("newword")).length, 1);
    });
});
