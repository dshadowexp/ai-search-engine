import { sleep } from "@search/core";
import type { ResolvedIndexingConfig } from "./config.ts";
import type { Indexer } from "./indexer.ts";
import type { IndexJobStore } from "./storage/job-store.ts";
import { StaleStageLeaseError, type IndexJob, type IndexStage, type IndexingStats, type StageLease } from "./types.ts";
import { LogStream } from "@search/infra";

export interface IndexerDependencies {
    jobs: IndexJobStore; 
    indexer: Indexer
}

interface Heartbeat {
    readonly lease: StageLease;
    readonly lost: boolean;
    stop(): void;
}

const MIN_WAIT_MS = 10;
const MAX_WAIT_MS = 1_000;
const MIN_HEARTBEAT_MS = 10;

/** Claim a stage -> run it -> complete -> publish. Stateless: all durable state is in the stores. */
export class IndexerWorker {
    private readonly deps: IndexerDependencies;
    private readonly config: ResolvedIndexingConfig;
    readonly workerId: string;
    private readonly stages: readonly IndexStage[];
    private readonly stats: IndexingStats;

    constructor(
        deps: IndexerDependencies,
        config: ResolvedIndexingConfig,
        workerId: string,
        stages: readonly IndexStage[],
        stats: IndexingStats,
    ) {
        this.deps = deps;
        this.config = config;
        this.workerId = workerId;
        this.stages = stages;
        this.stats = stats;
    }

    async run(signal: AbortSignal): Promise<void> {
        while (!signal.aborted) {
            let lease: StageLease | null = null;
            try {
                lease = await this.deps.jobs.claimNext(this.workerId, this.stages);
            } catch {
                this.stats.internalErrors++;
                await sleep(MAX_WAIT_MS, signal);
                continue;
            }

            if (!lease) {
                await this.waitForWork(signal);
                continue;
            }

            await this.processLease(lease, signal);
        }
    }

    private async processLease(lease: StageLease, signal: AbortSignal): Promise<void> {
        const job = new AbortController();
        const heartbeat = this.startHeartbeat(lease, job);
        this.stats.activeJobs++;

        try {
            LogStream.getInstance().log(lease.documentId, '\t[Indexing')
            await this.deps.indexer.execute(lease, AbortSignal.any([signal, job.signal]));
            if (heartbeat.lost) {
                this.stats.staleLeases++;
                return;
            }

            if (signal.aborted) {
                await this.releaseForShutdown(heartbeat.lease);
                return;
            }
            
            const completed = await this.deps.jobs.complete(heartbeat.lease);
            this.stats.stagesCompleted[lease.stage]++;
            await this.publish(completed);
        } catch (err) {
            await this.recover(heartbeat, signal, err);
        } finally {
            heartbeat.stop();
            this.stats.activeJobs--;
        }
    }

    /** A failed publish is not a failed stage: the reconciler picks the job up again. */
    private async publish(job: IndexJob): Promise<void> {
        try {
            await this.deps.indexer.publish(job);
        } catch {
            this.stats.publishFailures++;
        }
    }

    private async recover(heartbeat: Heartbeat, signal: AbortSignal, err: unknown): Promise<void> {
        if (heartbeat.lost || err instanceof StaleStageLeaseError) {
            this.stats.staleLeases++;
            return;
        }

        if (signal.aborted) {
            await this.releaseForShutdown(heartbeat.lease);
            return;
        }
        const retryable = true; // indexing errors get bounded retries
        try {
            const job = await this.deps.jobs.fail(heartbeat.lease, err instanceof Error ? err.message : String(err), { retryable });
            if (job.stages[heartbeat.lease.stage].status === "failed") this.stats.deadLettered++;
            else this.stats.retries++;
            if (job.stages[heartbeat.lease.stage].status === "failed") await this.publish(job); // lets a dead required stage mark the version abandoned
        } catch (reportErr) {
            if (reportErr instanceof StaleStageLeaseError) this.stats.staleLeases++;
            else this.stats.internalErrors++;
        }
    }

    private async releaseForShutdown(lease: StageLease): Promise<void> {
        try {
            await this.deps.jobs.release(lease, "shutdown"); // does not consume an attempt
            this.stats.shutdownReleases++;
        } catch {
        /* lease already expired or re-assigned */
        }
    }

  private startHeartbeat(initial: StageLease, job: AbortController): Heartbeat {
        let current = initial;
        let lost = false;
        let renewing = false;
        const everyMs = Math.max(MIN_HEARTBEAT_MS, (initial.expiresAt - this.config.now()) / 3);
        const timer = setInterval(async () => {
            if (renewing || lost) return;
            renewing = true;
            try {
                current = await this.deps.jobs.renew(current);
            } catch (err) {
                if (err instanceof StaleStageLeaseError) {
                lost = true;
                job.abort(new Error("lease lost"));
                } else {
                this.stats.internalErrors++;
                }
            } finally {
                renewing = false;
            }
        }, everyMs);

        return {
            get lease() {
                return current;
            },
            get lost() {
                return lost;
            },
            stop: () => clearInterval(timer),
        };
    }

    private async waitForWork(signal: AbortSignal): Promise<void> {
        const next = this.deps.jobs.nextDueAt(this.stages);
        const ms = next === null ? this.config.idlePollMs : Math.min(Math.max(next - this.config.now(), MIN_WAIT_MS), MAX_WAIT_MS);
        await sleep(ms, signal);
    }
}
