import { randomUUID } from "node:crypto";
import { PriorityQueue } from "@search/shared";
import {
    INDEX_STAGES,
    StaleStageLeaseError,
    type IndexJob,
    type IndexStage,
    type JobStats,
    type StageLease,
    type StageStatus,
} from "../types.js";

/**
 * Durable, lease-based work queue with one independently scheduled state machine PER STAGE
 * (same philosophy as the frontier: lease, don't remove; fence stale workers with tokens).
 * In SQL this is the `indexing_jobs` table with FOR UPDATE SKIP LOCKED claiming.
 */
export interface IndexJobStore {
    /**
     * Creates the job, or resets just the listed stages of an existing one (re-indexing).
     * Unlisted stages of a NEW job are "skipped". Pending stages of older versions are superseded.
     */
    enqueue(documentId: string, version: number, stages: Partial<Record<IndexStage, "pending" | "skipped">>): Promise<IndexJob>;
    claimNext(workerId: string, stages: readonly IndexStage[]): Promise<StageLease | null>;
    renew(lease: StageLease): Promise<StageLease>;
    complete(lease: StageLease): Promise<IndexJob>;
    /** Retryable failures back off exponentially; non-retryable ones, or too many attempts, dead-letter the stage. */
    fail(lease: StageLease, error: string, opts: { retryable: boolean }): Promise<IndexJob>;
    /** Hand the stage back without consuming an attempt (graceful shutdown). */
    release(lease: StageLease, reason: string): Promise<void>;
    reapExpiredLeases(): Promise<number>;
    markPublished(documentId: string, version: number, stages: readonly IndexStage[]): Promise<void>;
    /** Jobs with a completed stage whose result is not yet searchable/retired: the reconciler's worklist. */
    listUnpublished(): Promise<IndexJob[]>;
    get(documentId: string, version: number): Promise<IndexJob | undefined>;
    /** When the earliest pending stage of these kinds becomes due (ms epoch), or null. */
    nextDueAt(stages: readonly IndexStage[]): number | null;
    getStats(): Promise<JobStats>;
}

export interface JobStoreConfig {
    now?: () => number;
    leaseTtlMs?: number;
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
}

interface Slot {
    key: string;
    stamp: number;
    at: number;
    seq: number;
}

interface Internal {
    job: IndexJob;
    stamps: Record<IndexStage, number>; // bumped on every re-schedule/invalidation: stale heap slots lose
}

const STATUSES: StageStatus[] = ["pending", "processing", "completed", "failed", "skipped"];
const zeroCounts = () => Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<StageStatus, number>;
const newQueue = () => new PriorityQueue<Slot>((a, b) => (a.at !== b.at ? a.at < b.at : a.seq < b.seq));

export class InMemoryIndexJobStore implements IndexJobStore {
    private readonly now: () => number;
    private readonly leaseTtlMs: number;
    private readonly maxAttempts: number;
    private readonly baseDelayMs: number;
    private readonly maxDelayMs: number;

    private readonly jobs = new Map<string, Internal>();
    private readonly byDocument = new Map<string, Set<number>>();
    private readonly queues: Record<IndexStage, PriorityQueue<Slot>> = { lexical: newQueue(), semantic: newQueue() };
    private readonly processing = new Set<string>(); // `${jobId}|${stage}`
    private readonly unpublished = new Set<string>();
    private readonly counts: Record<IndexStage, Record<StageStatus, number>> = { lexical: zeroCounts(), semantic: zeroCounts() };
    private seq = 0;

    constructor(cfg: JobStoreConfig = {}) {
        this.now = cfg.now ?? Date.now;
        this.leaseTtlMs = cfg.leaseTtlMs ?? 60_000;
        this.maxAttempts = cfg.maxAttempts ?? 5;
        this.baseDelayMs = cfg.baseDelayMs ?? 1_000;
        this.maxDelayMs = cfg.maxDelayMs ?? 300_000;
    }

    async enqueue(documentId: string, version: number, stages: Partial<Record<IndexStage, "pending" | "skipped">>): Promise<IndexJob> {
        const id = `${documentId}@${version}`;
        const now = this.now();
        let internal = this.jobs.get(id);
        if (!internal) {
        internal = {
            job: {
            id,
            documentId,
            version,
            createdAt: now,
            stages: Object.fromEntries(
                INDEX_STAGES.map((s) => [s, { status: "skipped", attempts: 0, nextAttemptAt: now, published: false, updatedAt: now }]),
            ) as IndexJob["stages"],
            },
            stamps: { lexical: 0, semantic: 0 },
        };

        for (const s of INDEX_STAGES) this.counts[s].skipped++;
            this.jobs.set(id, internal);
            const versions = this.byDocument.get(documentId) ?? new Set<number>();
            versions.add(version);
            this.byDocument.set(documentId, versions);
        }

        for (const stage of INDEX_STAGES) {
            const want = stages[stage];
            if (!want) continue;
            const st = internal.job.stages[stage];
            this.processing.delete(`${id}|${stage}`); // a re-enqueue revokes any running lease
            this.setStatus(internal, stage, want);
            st.attempts = 0;
            st.nextAttemptAt = now;
            st.published = false;
            if (want === "pending") this.schedule(internal, stage, now);
            else internal.stamps[stage]++;
        }

        this.supersedeOlder(documentId, version);
        this.refreshUnpublished(internal);
        return structuredClone(internal.job);
    }

    async claimNext(workerId: string, stages: readonly IndexStage[]): Promise<StageLease | null> {
        await this.reapExpiredLeases();
        const now = this.now();
        let best: { stage: IndexStage; slot: Slot } | undefined;
        for (const stage of stages) {
            const slot = this.peekValid(stage);
            if (slot && slot.at <= now && (!best || slot.at < best.slot.at)) best = { stage, slot };
        }

        if (!best) 
            return null;

        this.queues[best.stage].pop();
        const internal = this.jobs.get(best.slot.key)!;
        const st = internal.job.stages[best.stage];
        this.setStatus(internal, best.stage, "processing");
        st.attempts++;
        st.lease = { 
            workerId, 
            token: randomUUID(), 
            expiresAt: now + this.leaseTtlMs 
        };

        this.processing.add(`${internal.job.id}|${best.stage}`);
        return this.toLease(internal, best.stage);
    }

    async renew(lease: StageLease): Promise<StageLease> {
        const internal = this.requireActive(lease);
        const st = internal.job.stages[lease.stage];
        st.lease!.expiresAt = this.now() + this.leaseTtlMs;
        return { ...lease, expiresAt: st.lease!.expiresAt };
    }

    async complete(lease: StageLease): Promise<IndexJob> {
        const internal = this.requireActive(lease);
        const st = internal.job.stages[lease.stage];
        this.processing.delete(`${lease.jobId}|${lease.stage}`);
        st.published = false;
        this.setStatus(internal, lease.stage, "completed");
        this.refreshUnpublished(internal);
        return structuredClone(internal.job);
    }

    async fail(lease: StageLease, error: string, opts: { retryable: boolean }): Promise<IndexJob> {
        const internal = this.requireActive(lease);
        this.failInternal(internal, lease.stage, error, opts.retryable);
        return structuredClone(internal.job);
    }

    async release(lease: StageLease, reason: string): Promise<void> {
        const internal = this.requireActive(lease);
        const st = internal.job.stages[lease.stage];
        this.processing.delete(`${lease.jobId}|${lease.stage}`);
        st.attempts--;
        st.lastError = `released: ${reason}`;
        this.setStatus(internal, lease.stage, "pending");
        st.nextAttemptAt = this.now();
        this.schedule(internal, lease.stage, st.nextAttemptAt);
    }

    async reapExpiredLeases(): Promise<number> {
        const now = this.now();
        let n = 0;
        for (const pk of [...this.processing]) {
            const [jobId, stage] = pk.split("|") as [string, IndexStage];
            const internal = this.jobs.get(jobId)!;
            if ((internal.job.stages[stage].lease?.expiresAt ?? Infinity) <= now) {
                this.failInternal(internal, stage, "lease expired", true, true);
                n++;
            }
        }

        return n;
    }

    async markPublished(documentId: string, version: number, stages: readonly IndexStage[]): Promise<void> {
        const internal = this.jobs.get(`${documentId}@${version}`);
        if (!internal) return;
        for (const s of stages) internal.job.stages[s].published = true;
        this.refreshUnpublished(internal);
    }

    async listUnpublished(): Promise<IndexJob[]> {
        return [...this.unpublished].map((k) => structuredClone(this.jobs.get(k)!.job));
    }

    async get(documentId: string, version: number): Promise<IndexJob | undefined> {
        const internal = this.jobs.get(`${documentId}@${version}`);
        return internal ? structuredClone(internal.job) : undefined;
    }

    nextDueAt(stages: readonly IndexStage[]): number | null {
        let next: number | null = null;
        for (const stage of stages) {
            const slot = this.peekValid(stage);
            if (slot && (next === null || slot.at < next)) next = slot.at;
        }
        return next;
    }

    async getStats(): Promise<JobStats> {
        return { stages: structuredClone(this.counts), unpublished: this.unpublished.size };
    }

    // ───────────── internals ─────────────

    /** `immediate`: a dead worker is not the stage's fault, so recover at once (still counts as an attempt), like the frontier's lease reaper. */
    private failInternal(internal: Internal, stage: IndexStage, error: string, retryable: boolean, immediate = false): void {
        const st = internal.job.stages[stage];
        this.processing.delete(`${internal.job.id}|${stage}`);
        st.lastError = error;
        if (!retryable || st.attempts >= this.maxAttempts) {
        this.setStatus(internal, stage, "failed"); // dead letter: stays inspectable, never retried automatically
        return;
        }
        this.setStatus(internal, stage, "pending");
        st.nextAttemptAt = immediate ? this.now() : this.now() + Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (st.attempts - 1));
        this.schedule(internal, stage, st.nextAttemptAt);
    }

    private supersedeOlder(documentId: string, version: number): void {
        for (const v of this.byDocument.get(documentId) ?? []) {
            if (v >= version) continue;
            const internal = this.jobs.get(`${documentId}@${v}`)!;
            for (const stage of INDEX_STAGES) {
                if (internal.job.stages[stage].status !== "pending") continue; // running work finishes and is cleaned up on publish
                this.setStatus(internal, stage, "skipped");
                internal.job.stages[stage].lastError = `superseded by v${version}`;
                internal.stamps[stage]++;
            }
        }
    }

    private peekValid(stage: IndexStage): Slot | undefined {
        const q = this.queues[stage];
        for (;;) {
            const top = q.peek();
            if (!top) return undefined;
            const internal = this.jobs.get(top.key);
            if (internal && internal.stamps[stage] === top.stamp && internal.job.stages[stage].status === "pending") return top;
            q.pop(); // superseded, reset or already claimed
        }
    }

    private schedule(internal: Internal, stage: IndexStage, at: number): void {
        const stamp = ++internal.stamps[stage];
        this.queues[stage].push({ key: internal.job.id, stamp, at, seq: this.seq++ });
    }

    private setStatus(internal: Internal, stage: IndexStage, next: StageStatus): void {
        const st = internal.job.stages[stage];
        this.counts[stage][st.status]--;
        st.status = next;
        st.updatedAt = this.now();
        this.counts[stage][next]++;
    }

    private refreshUnpublished(internal: Internal): void {
        const pending = INDEX_STAGES.some((s) => internal.job.stages[s].status === "completed" && !internal.job.stages[s].published);
        if (pending) this.unpublished.add(internal.job.id);
        else this.unpublished.delete(internal.job.id);
    }

    private requireActive(lease: StageLease): Internal {
        const internal = this.jobs.get(lease.jobId);
        const st = internal?.job.stages[lease.stage];
        if (!internal || !st || st.status !== "processing" || st.lease?.token !== lease.token) throw new StaleStageLeaseError(lease);
        return internal;
    }

    private toLease(internal: Internal, stage: IndexStage): StageLease {
        const st = internal.job.stages[stage];
        return {
            jobId: internal.job.id,
            documentId: internal.job.documentId,
            version: internal.job.version,
            stage,
            workerId: st.lease!.workerId,
            token: st.lease!.token,
            expiresAt: st.lease!.expiresAt,
            attempt: st.attempts,
        };
    }
}
