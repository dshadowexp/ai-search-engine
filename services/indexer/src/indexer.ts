import type { LexicalIndexer } from "./lexical/lexical-indexer.js";
import type { DocumentRepository } from "./storage/document-repository.js";
import type { IndexJobStore } from "./storage/job-store.js";
import type { LexicalRepository } from "./storage/lexical-repository.js";
import { INDEX_STAGES, type IndexJob, type IndexingStats, type StageLease } from "./types.js";

export interface IndexerDependencies {
    documents: DocumentRepository;
    jobs: IndexJobStore;
    lexical: LexicalRepository;
    lexicalIndexer: LexicalIndexer;
}

/**
 * Coordinates lexical indexing and version publication. Workers own leases; this owns "what is searchable".
 */
export class Indexer {
    constructor(
        private readonly deps: IndexerDependencies,
        private readonly cfg: { now: () => number },
        private readonly stats: IndexingStats,
    ) {}

    /** Runs one stage for one document version. Idempotent: running it twice never duplicates data. */
    async execute(lease: StageLease, signal: AbortSignal): Promise<void> {
        const doc = await this.deps.documents.getVersion(lease.documentId, lease.version);
        if (!doc) {
            this.stats.obsoleteStages++; // retired by a newer active version while this job waited
            return;
        }

        await this.deps.lexicalIndexer.index(doc);
    }

    /**
     * Makes a completed lexical version searchable. Idempotent and safe to run repeatedly.
     */
    async publish(job: IndexJob): Promise<void> {
        if (job.stages.lexical.status !== "completed") return;

        const record = await this.deps.documents.get(job.documentId);
        if (!record) return;

        const active = record.activeVersion ?? 0;
        if (job.version < active) {
            await this.retireBefore(job.documentId, active);
        } else if (job.version === active) {
            await this.deps.lexical.activate(job.documentId, job.version);
        } else {
            if (await this.deps.documents.setActiveVersion(job.documentId, job.version, this.cfg.now())) {
                this.stats.activations++;
            }
            await this.deps.lexical.activate(job.documentId, job.version);
            await this.retireBefore(job.documentId, job.version);
        }

        await this.deps.jobs.markPublished(job.documentId, job.version, INDEX_STAGES);
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

    private async retireBefore(documentId: string, version: number): Promise<void> {
        await this.deps.documents.removeVersionsBefore(documentId, version);
        await this.deps.lexical.removeVersionsBefore(documentId, version);
    }
}
