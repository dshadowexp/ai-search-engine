import { sleep } from "@search/core";
import type { Indexer } from "./indexer.js";
import { IndexerWorker } from "./worker.js";
import type { ResolvedIndexingConfig } from "./config.js";
import type { DocumentRepository } from "./storage/document-repository.js";
import type { IndexJobStore } from "./storage/job-store.js";
import type { CorpusStats, LexicalRepository } from "./storage/lexical-repository.js";
import { INDEX_STAGES, type IndexStage, type IndexingStats, type IngestStats, type JobStats } from "./types.ts";

export interface IndexingPipelineStats {
    ingest: IngestStats;
    indexing: IndexingStats;
    jobs: JobStats;
    corpus: CorpusStats;
}

/** Bounded worker pools, one per stage, plus a reconciler. The counterpart of `Crawler` for indexing. */
export class IndexingPipeline {
    private controller: AbortController | undefined;
    private running: Promise<void>[] = [];
    private reconciler?: NodeJS.Timeout;

    constructor(
        private readonly deps: { jobs: IndexJobStore; indexer: Indexer; documents: DocumentRepository; lexical: LexicalRepository },
        private readonly config: ResolvedIndexingConfig,
        private readonly stats: IndexingStats,
        private readonly ingestStats: IngestStats,
    ) {}

    start(): void {
        if (this.controller) return;
        const controller = (this.controller = new AbortController());

        for (let i = 0; i < this.config.lexicalConcurrency; i++) {
            const worker = new IndexerWorker(this.deps, this.config, `indexer-${process.pid}-lexical-${i}`, ["lexical"], this.stats);
            this.running.push(worker.run(controller.signal));
        }
        
        this.reconciler = setInterval(() => void this.deps.indexer.reconcile().catch(() => this.stats.internalErrors++), this.config.reconcileIntervalMs);
        this.reconciler.unref();
    }

    /** Graceful: running stages are aborted and handed back without consuming an attempt. */
    async stop(): Promise<void> {
        this.controller?.abort();
        clearInterval(this.reconciler);
        await Promise.allSettled(this.running);
        this.controller = undefined;
        this.running = [];
    }

    /** Resolves when no stage is pending or processing and every completed stage has been published. */
    async waitUntilIdle(options: { pollMs?: number; signal?: AbortSignal } = {}): Promise<void> {
        const pollMs = options.pollMs ?? 20;
        for (;;) {
            await this.deps.indexer.reconcile();
            const s = await this.deps.jobs.getStats();
            const open = INDEX_STAGES.reduce((n, stage) => n + s.stages[stage].pending + s.stages[stage].processing, 0);
            if (open === 0) return;
            if (options.signal?.aborted) return;
            await sleep(pollMs, options.signal);
        }
    }

    /**
     * Rebuild lexical postings for every active document, e.g. after improving the analyzer.
     */
    async reindex(): Promise<number> {
        const active = await this.deps.documents.listActive();

        for (const { id, activeVersion } of active) 
            await this.deps.jobs.enqueue(id, activeVersion, { lexical: "pending" });

        return active.length;
    }

    async getStats(): Promise<IndexingPipelineStats> {
        return {
            ingest: { ...this.ingestStats },
            indexing: { ...this.stats, stagesCompleted: { ...this.stats.stagesCompleted } },
            jobs: await this.deps.jobs.getStats(),
            corpus: await this.deps.lexical.getCorpusStats(),
        };
    }
}
