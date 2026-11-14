import type { LexicalIndexer } from "./lexical/lexical-indexer.js";
import type { SemanticIndexer } from "./semantic/semantic-indexer.js";
import type { DocumentRepository } from "./storage/document-repository.js";
import type { IndexJobStore } from "./storage/job-store.js";
import type { LexicalRepository } from "./storage/lexical-repository.js";
import type { VectorRepository } from "./storage/vector-repository.js";
import { INDEX_STAGES, type IndexJob, type IndexStage, type IndexingStats, type StageLease } from "./types.js";

export interface IndexerDependencies {
    documents: DocumentRepository;
    jobs: IndexJobStore;
    lexical: LexicalRepository;
    lexicalIndexer: LexicalIndexer;
    vectors?: VectorRepository | undefined;
    semanticIndexer?: SemanticIndexer | undefined;
}

/**
 * Coordinates stage execution and VERSION PUBLICATION. It contains no tokenization, BM25, chunking or
 * embedding logic: those live in the stage indexers. Workers own leases; this owns "what is searchable".
 */
export class Indexer {
    constructor(
        private readonly deps: IndexerDependencies,
        private readonly cfg: { now: () => number; activationStages: readonly IndexStage[] },
        private readonly stats: IndexingStats,
    ) {}

    /** Runs one stage for one document version. Idempotent: running it twice never duplicates data. */
    async execute(lease: StageLease, signal: AbortSignal): Promise<void> {
        const doc = await this.deps.documents.getVersion(lease.documentId, lease.version);
        if (!doc) {
            this.stats.obsoleteStages++; // retired by a newer active version while this job waited
            return;
        }

        if (lease.stage === "lexical") {
            await this.deps.lexicalIndexer.index(doc);
        } else {
            if (!this.deps.semanticIndexer) throw new Error("semantic stage claimed but no embedding client is configured");
            await this.deps.semanticIndexer.index(doc, signal);
        }
    }

    /**
     * Makes completed stages searchable. Idempotent and safe to run concurrently or repeatedly.
     *  - older than the active version: its data is garbage -> retire
     *  - the active version (a late stage, or a re-index): make that stage searchable
     *  - newer than the active version: promote once every activation stage is done, then retire the old one
     * Old data is retired at promotion, so search never mixes old vectors with new text.
     */
    async publish(job: IndexJob): Promise<void> {
        const record = await this.deps.documents.get(job.documentId);
        if (!record) 
            return;

        const active = record.activeVersion ?? 0;
        const completed = INDEX_STAGES.filter((s) => job.stages[s].status === "completed");
        let handled: readonly IndexStage[] = [];

        if (job.version < active) {
            await this.retireBefore(job.documentId, active);
            handled = completed;
        } else if (job.version === active) {
            for (const stage of completed) 
                await this.activateStage(job.documentId, job.version, stage);
            handled = completed;
        } else if (this.cfg.activationStages.every((s) => ["completed", "skipped"].includes(job.stages[s].status))) {
            if (await this.deps.documents.setActiveVersion(job.documentId, job.version, this.cfg.now())) 
                this.stats.activations++;

            for (const stage of completed) 
                await this.activateStage(job.documentId, job.version, stage);

                await this.retireBefore(job.documentId, job.version);
                handled = completed;
        } else if (this.cfg.activationStages.some((s) => job.stages[s].status === "failed")) {
            handled = completed; // abandoned: a required stage dead-lettered, so this version will never be promoted
        }

        if (handled.length) 
            await this.deps.jobs.markPublished(job.documentId, job.version, handled);
    }

    /** Recovers from crashes between "stage completed" and "stage published". */
    async reconcile(): Promise<number> {
        let n = 0;
        for (const job of await this.deps.jobs.listUnpublished()) {
            try {
                await this.publish(job);
                n++;
            } catch {
                this.stats.publishFailures++;
            }
        }

        return n;
    }

    private async activateStage(documentId: string, version: number, stage: IndexStage): Promise<void> {
        if (stage === "lexical") await this.deps.lexical.activate(documentId, version);
        else await this.deps.vectors?.activate(documentId, version);
    }

    private async retireBefore(documentId: string, version: number): Promise<void> {
        await this.deps.documents.removeVersionsBefore(documentId, version);
        await this.deps.lexical.removeVersionsBefore(documentId, version);
        await this.deps.vectors?.removeVersionsBefore(documentId, version);
    }
}
