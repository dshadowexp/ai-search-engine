import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashUrl, type IndexedDocumentMessage } from "@search/core";
import { LexicalIndexer } from "./lexical/lexical-indexer.ts";
import { StandardAnalyzer } from "./processor/analyzer.ts";
import { InMemoryDocumentRepository } from "./storage/document-repository.ts";
import { InMemoryIndexJobStore } from "./storage/job-store.ts";
import { InMemoryLexicalRepository } from "./storage/lexical-repository.ts";
import { Indexer } from "./indexer.ts";
import type { IndexDocument, IndexingStats } from "./types.ts";

describe("Indexer semantic dispatch", () => {
    it("stores and publishes the active indexed document reference", async () => {
        const url = "https://example.com/semantic";
        const document: IndexDocument = {
            id: hashUrl(url),
            url,
            title: "Semantic document",
            description: null,
            content: "normalized content",
            language: "en",
            contentHash: "a".repeat(64),
            version: 1,
            fetchedAt: 1,
            createdAt: 1,
        };
        const documents = new InMemoryDocumentRepository();
        await documents.appendVersion(document, 0);

        const jobs = new InMemoryIndexJobStore({ now: () => 1 });
        await jobs.enqueue(document.id, document.version, { lexical: "pending" });
        const lease = await jobs.claimNext("test-worker", ["lexical"]);
        assert.ok(lease);
        const completedJob = await jobs.complete(lease);

        const savedReference = {
            key: `indexed-documents/${document.id}/v${document.version}.json.gz`,
            documentId: document.id,
            version: document.version,
            contentHash: document.contentHash,
        };
        const savedDocuments: IndexDocument[] = [];
        const messages: IndexedDocumentMessage[] = [];
        const stats: IndexingStats = {
            stagesCompleted: { lexical: 0 },
            retries: 0,
            deadLettered: 0,
            staleLeases: 0,
            shutdownReleases: 0,
            obsoleteStages: 0,
            publishFailures: 0,
            activations: 0,
            internalErrors: 0,
            activeJobs: 0,
        };
        const lexical = new InMemoryLexicalRepository();
        const indexer = new Indexer(
            {
                documents,
                jobs,
                lexical,
                lexicalIndexer: new LexicalIndexer(new StandardAnalyzer(), lexical),
                indexedDocuments: {
                    async saveVersion(indexedDocument) {
                        savedDocuments.push(indexedDocument);
                        return savedReference;
                    },
                },
                semanticQueue: {
                    async publish(message) {
                        messages.push(message);
                    },
                },
            },
            { now: () => 1 },
            stats,
        );

        await indexer.publish(completedJob);

        assert.deepEqual(savedDocuments, [document]);
        assert.equal(messages.length, 1);
        assert.equal(messages[0]?.eventId, `${document.id}@${document.version}`);
        assert.deepEqual(messages[0]?.document, savedReference);
        assert.equal((await jobs.get(document.id, document.version))?.stages.lexical.published, true);
    });
});
