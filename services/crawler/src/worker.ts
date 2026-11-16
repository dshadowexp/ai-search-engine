import { type Lease, type IFrontier } from "./url-frontier/types.ts";
import type { CrawlerDependencies, ResolvedCrawlerConfig } from "./config.ts";
import { classifyResponse } from "./http-fetch/response-classifier.ts";
import { detectContentKind, validateContent } from "./processor/content-detector.ts";
import type {CrawlerStats, CrawlResult, ResponseHead } from "./types.ts";
import { InfraError, LogStream } from "@search/infra";
import { sleep, type CrawledDocument } from "@search/core";
import { FetchError } from "./errors.ts";
import { StaleLeaseError } from "./url-frontier/errors.ts";
import { createCrawledDocumentMessage } from "./queue/crawled-document-message.ts";
import { ProcessorRouter } from "./processor/processor-router.ts";

export interface WorkerDependences extends CrawlerDependencies {
    processor: ProcessorRouter;
}

interface Outcome {
  result: CrawlResult;
  document?: CrawledDocument | undefined;
}

interface Heartbeat {
  readonly lease: Lease;
  readonly lost: boolean;
  stop(): void;
}

const MIN_WAIT_MS = 10;
const MAX_WAIT_MS = 1_000;
const MIN_HEARTBEAT_MS = 10;

/**
 * Claim -> fetch -> process -> persist -> acknowledge, one job at a time.
 * Stateless: everything durable lives in the frontier and the document store.
 *
 * What the frontier already owns (so it is deliberately absent here): robots.txt, per-host
 * concurrency and crawl delay, retry/backoff, deduplication and admission of discovered links.
 */
export class CrawlerWorker {
    private readonly deps: WorkerDependences;
    private readonly config: ResolvedCrawlerConfig;
    readonly workerId: string;
    private readonly stats: CrawlerStats;

    constructor(
        deps: WorkerDependences,
        config: ResolvedCrawlerConfig,
        workerId: string,
        stats: CrawlerStats,
    ) {
        this.deps = deps;
        this.config = config;
        this.workerId = workerId;
        this.stats = stats;
    }

    async run(signal: AbortSignal): Promise<void> {
        while (!signal.aborted) {
            let lease: Lease | null = null;
            try {
                lease = await this.deps.frontier.claimNext(this.workerId);
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

    private async processLease(lease: Lease, signal: AbortSignal): Promise<void> {
        const job = new AbortController();
        const heartbeat = this.startHeartbeat(lease, job);
        this.stats.activeJobs++;

        try {
            const outcome = await this.crawl(lease, AbortSignal.any([signal, job.signal]));

            if (heartbeat.lost) {
                this.stats.staleLeases++; // another worker owns this URL now; drop our work
                return;
            }

            if (signal.aborted) {
                await this.releaseForShutdown(heartbeat.lease);
                return;
            }

            // Persist BEFORE acknowledging. A crash in between just means the URL is crawled again
            // (the store is idempotent). Discovered links are enqueued by acknowledge() itself.
            if (outcome.document) {
                const reference = await this.deps.documentStore.save(outcome.document);
                await this.deps.indexQueue.publish(createCrawledDocumentMessage(reference));
                this.stats.pagesStored++;
            }

            await this.report(heartbeat.lease, outcome.result);
        } catch (err) {
            if (err instanceof InfraError)
                console.log(err.message);
            await this.recover(heartbeat, signal, err);
        } finally {
            heartbeat.stop();
            this.stats.activeJobs--;
        }
    }

    private async crawl(lease: Lease, signal: AbortSignal): Promise<Outcome> {
        LogStream.getInstance().log(lease.url, 'CRAWL');
        const supported = new Set(this.config.supportedKinds);
        const wantsBody = (head: ResponseHead) => {
            if (head.statusCode < 200 || head.statusCode >= 300) 
                return false;

            const kind = detectContentKind(head.contentType);
            return kind === "unknown" || supported.has(kind);
        };

        let res;
        try {
            res = await this.deps.httpClient.fetch(lease.url, { signal, acceptBody: wantsBody });
        } catch (err) {
            if (err instanceof FetchError && err.kind !== "aborted") {
                return { result: { outcome: err.retryable ? "retryable_failure" : "permanent_failure", error: err.message } };
            }
            throw err; // aborted (shutdown / lease lost) or a bug: handled by processLease
        }

        this.stats.bytesDownloaded += res.body.byteLength;

        const classified = classifyResponse(res, this.config.now());
        if (classified.kind === "done") 
            return { result: classified.result };

        const verdict = validateContent(res.contentType, res.body, supported);
        if (!verdict.ok) {
            // The frontier has no "skipped" state; a permanent failure keeps the reason visible on the entry.
            return { result: { outcome: "permanent_failure", error: `skipped: ${verdict.reason}` } };
        }

        const page = this.deps.processor.process({
            url: lease.url,
            kind: verdict.kind,
            contentType: res.contentType,
            body: res.body,
            fetchedAt: this.config.now(),
            depth: lease.depth,
            truncated: res.truncated,
        });

        LogStream.getInstance().log(
            page.document?.links.length,
            '\t[OUTCOME'
        )

        return { 
            result: { outcome: "success", discoveredLinks: page.links }, 
            document: page.document ?? undefined 
        };
    }

    /** Never throws: a failed report leaves the lease to expire and be recovered by the frontier. */
    private async report(lease: Lease, result: CrawlResult): Promise<void> {
        try {
            await this.deps.frontier.acknowledge(lease, result);
        } catch (err) {
            if (err instanceof StaleLeaseError) 
                this.stats.staleLeases++;
            else 
                this.stats.internalErrors++;
            
            return;
        }
            
        switch (result.outcome) {
            case "success":
                this.stats.linksDiscovered += result.discoveredLinks?.length ?? 0;
                break;
            case "redirect":
                this.stats.redirects++;
                break;
            case "retryable_failure":
                this.stats.retryableFailures++;
                break;
            case "permanent_failure":
                if (result.error?.startsWith("skipped:")) this.stats.pagesSkipped++;
                else this.stats.permanentFailures++;
                break;
        }
    }

    private async recover(heartbeat: Heartbeat, signal: AbortSignal, err: unknown): Promise<void> {
        if (heartbeat.lost) {
            this.stats.staleLeases++;
            return;
        }

        if (signal.aborted) {
            await this.releaseForShutdown(heartbeat.lease);
            return;
        }
        // A bug or a storage error: count it as a failed attempt so a poison URL can't loop forever.
        this.stats.internalErrors++;
        await this.report(heartbeat.lease, { outcome: "retryable_failure", error: `internal error: ${describe(err)}` });
    }

    private async releaseForShutdown(lease: Lease): Promise<void> {
        try {
            await this.deps.frontier.release(lease, "shutdown"); // does not consume an attempt
            this.stats.shutdownReleases++;
        } catch {
            /* lease already expired or reassigned: nothing to give back */
        }
    }

    /** Renews the lease while we work. If the frontier says it is gone, abort the in-flight request. */
    private startHeartbeat(initial: Lease, job: AbortController): Heartbeat {
        let current = initial;
        let lost = false;
        let renewing = false;
        const everyMs = Math.max(MIN_HEARTBEAT_MS, (initial.expiresAt - this.config.now()) / 3);

        const timer = setInterval(async () => {
            if (renewing || lost) 
                return;

            renewing = true;
            try {
                current = await this.deps.frontier.renewLease(current);
            } catch (err) {
                if (err instanceof StaleLeaseError) {
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
        const next = this.deps.frontier.nextEligibleAt();
        const ms = next === null ? this.config.idlePollMs : Math.min(Math.max(next - this.config.now(), MIN_WAIT_MS), MAX_WAIT_MS);
        await sleep(ms, signal);
    }
}

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));
