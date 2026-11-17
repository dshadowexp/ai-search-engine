import { DocumentIngestor } from "./ingestion/document-ingestor.ts";
import { CrawledDocumentQueueConsumer } from "./ingestion/crawled-document-queue-consumer.ts";
import { Indexer } from "./indexer.ts";
import { Pipeline } from "./pipeline.ts";
import { resolveIndexingConfig, type IndexingConfig } from "./config.ts";
import { LexicalIndexer } from "./lexical/lexical-indexer.ts";
import { LexicalSearchService } from "./search/search-service.ts";
import { StandardAnalyzer, type Analyzer } from "./processor/analyzer.ts";
import { InMemoryDocumentRepository, type DocumentRepository } from "./storage/document-repository.ts";
import { InMemoryIndexJobStore, type IndexJobStore } from "./storage/job-store.ts";
import { InMemoryLexicalRepository, type LexicalRepository } from "./storage/lexical-repository.ts";
import type { IndexingStats, IngestStats } from "./types.ts";
import type { IndexerBlobDocuments, MessageQueueConsumer } from "@search/infra";
import type { CrawledDocumentMessage } from "@search/core";

export interface CreateIndexingPipelineOptions extends IndexingConfig {
    analyzer?: Analyzer;
    documents?: DocumentRepository;
    lexical?: LexicalRepository;
    jobs?: IndexJobStore;
    /** Provide these together to load persisted crawl events into the indexer. */
    blobDocuments?: IndexerBlobDocuments;
    documentQueue?: MessageQueueConsumer<CrawledDocumentMessage>;
}

/** Wires document ingestion and lexical indexing around shared stores and one clock. */
export function createIndexingPipeline(options: CreateIndexingPipelineOptions = {}) {
    const {
        analyzer = new StandardAnalyzer(),
        blobDocuments,
        documentQueue,
        ...configOptions
    } = options;
    const config = resolveIndexingConfig(configOptions);
    if (Boolean(blobDocuments) !== Boolean(documentQueue)) {
        throw new Error("blobDocuments and documentQueue must be provided together");
    }

    const documents = options.documents ?? new InMemoryDocumentRepository();
    const lexical = options.lexical ?? new InMemoryLexicalRepository();
    const jobs =
        options.jobs ??
        new InMemoryIndexJobStore({ now: config.now, leaseTtlMs: config.leaseTtlMs, ...config.retry });

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
    const ingestStats: IngestStats = { received: 0, created: 0, newVersions: 0, unchanged: 0, metadataUpdates: 0, stale: 0, rejected: 0 };

    const indexer = new Indexer(
        {
            documents,
            jobs,
            lexical,
            lexicalIndexer: new LexicalIndexer(analyzer, lexical),
        },
        config,
        stats,
    );

    const searchService = new LexicalSearchService({
        documents,
        analyzer,
        lexical,
        bm25: config.bm25,
    });

    const ingestor = new DocumentIngestor(
        { documents, jobs },
        { now: config.now, maxContentChars: config.maxContentChars },
        ingestStats,
    );

    const pipeline = new Pipeline({ jobs, indexer, documents, lexical }, config, stats, ingestStats);
    const documentConsumer = documentQueue && blobDocuments
        ? new CrawledDocumentQueueConsumer(documentQueue, blobDocuments, ingestor)
        : undefined;

    return {
        pipeline,
        ingestor,
        documentConsumer,
        searchService,
        documents,
        lexical,
        jobs,
    };
}
