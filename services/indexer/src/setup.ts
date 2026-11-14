import { DocumentIngestor } from "./ingestion/document-ingestor.js";
import { IngestingDocumentStore } from "./ingestion/ingesting-document-store.js";
import { Indexer } from "./indexer.ts";
import { IndexingPipeline } from "./pipeline.ts";
import { resolveIndexingConfig, type IndexingConfig } from "./config.ts";
import { LexicalIndexer } from "./lexical/lexical-indexer.ts";
import { StandardAnalyzer, type Analyzer } from "./processor/analyzer.ts";
import type { EmbeddingClient } from "./semantic/embedding-client.ts";
import { SemanticIndexer } from "./semantic/semantic-indexer.ts";
import { InMemoryDocumentRepository, type DocumentRepository } from "./storage/document-repository.ts";
import { InMemoryIndexJobStore, type IndexJobStore } from "./storage/job-store.ts";
import { InMemoryLexicalRepository, type LexicalRepository } from "./storage/lexical-repository.ts";
import { InMemoryVectorRepository, type VectorRepository } from "./storage/vector-repository.ts";
import type { IndexingStats, IngestStats } from "./types.ts";
// import { LexicalSearch } from "../search/lexical-search.js";
// import { SearchService } from "../search/search-service.js";
// import { SemanticSearch } from "../search/semantic-search.js";
// import type { DocumentStore } from "../storage/document-store.js";

export interface CreateIndexingPipelineOptions extends IndexingConfig {
    /** Omit to run lexical-only: the semantic stage is "skipped" and search never needs the ML service. */
    embeddingClient?: EmbeddingClient;
    analyzer?: Analyzer;
    documents?: DocumentRepository;
    lexical?: LexicalRepository;
    vectors?: VectorRepository;
    jobs?: IndexJobStore;
}

/** Wires ingestion, stage workers, publication and search around shared stores and one clock. */
export function createIndexingPipeline(options: CreateIndexingPipelineOptions = {}) {
    const { embeddingClient, analyzer = new StandardAnalyzer(), ...rest } = options;
    const semanticEnabled = embeddingClient !== undefined;
    const config = resolveIndexingConfig(rest, semanticEnabled);

    const documents = options.documents ?? new InMemoryDocumentRepository();
    const lexical = options.lexical ?? new InMemoryLexicalRepository();
    const vectors = semanticEnabled ? (options.vectors ?? new InMemoryVectorRepository()) : undefined;
    const jobs =
        options.jobs ??
        new InMemoryIndexJobStore({ now: config.now, leaseTtlMs: config.leaseTtlMs, ...config.retry });

    const stats: IndexingStats = {
        stagesCompleted: { lexical: 0, semantic: 0 },
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
            vectors,
            semanticIndexer:
                embeddingClient && vectors
                ? new SemanticIndexer(embeddingClient, vectors, { chunking: config.chunking, batchSize: config.embeddingBatchSize })
                : undefined,
        },
        config,
        stats,
    );

    const ingestor = new DocumentIngestor(
        { documents, jobs },
        { now: config.now, maxContentChars: config.maxContentChars, stages: { lexical: "pending", semantic: semanticEnabled ? "pending" : "skipped" } },
        ingestStats,
    );

    // const search = new SearchService({
    //     documents,
    //     analyzer,
    //     lexical: new LexicalSearch(analyzer, lexical, config.bm25),
    //     semantic: embeddingClient && vectors ? new SemanticSearch(embeddingClient, vectors, config.minSimilarity) : undefined,
    // });

    const pipeline = new IndexingPipeline({ jobs, indexer, documents, lexical }, config, semanticEnabled, stats, ingestStats);

    return {
        pipeline,
        ingestor,
        // search,
        documents,
        lexical,
        vectors,
        jobs,
        /** Plug into the crawler: `createCrawler({ documentStore: ingestingStore(new InMemoryDocumentStore()) })`. */
        // ingestingStore: (inner: DocumentStore): DocumentStore => new IngestingDocumentStore(inner, ingestor),
    };
}
