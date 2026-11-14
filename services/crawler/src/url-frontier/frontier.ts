import type { CrawlResult } from "../crawler/types.ts";
import { errorText, StaleLeaseError } from "./errors.ts";
import { InMemoryFrontierStore } from "./frontier-store.ts";
import { HostManager } from "./host/host-manager.ts";
import { LeaseManager } from "./leasing/lease-manager.ts";
import { normalizeUrl, type NormalizeOptions } from "./normalization/normalize-url.ts";
import { isPublicHostname } from "./normalization/ssrf-guard.ts";
import { hashUrl } from "./normalization/url-hash.ts";
import { RetryPolicy, type RetryPolicyConfig } from "./policies/retry-policy.ts";
import { HostScheduler } from "./scheduling/host-scheduler.ts";
import { nextEligibleAt } from "./scheduling/scheduler-policy.ts";
import type { RobotsPolicy } from "./policies/robots-policy.ts";
import type { HostQueue } from "./scheduling/host-queue.ts";
import type { 
    AddOptions,
    AddResult,
    CrawlState,
    FrontierEntry,
    FrontierStats,
    FrontierStore, 
    HostRecord, 
    Lease, 
    URLFrontier 
} from "./types.ts";

export interface FrontierConfig {
    /** Injectable clock (ms). Makes every time-based rule testable. */
    now?: () => number;
    leaseTtlMs?: number;
    maxConcurrencyPerHost?: number;
    defaultCrawlDelayMs?: number;
    maxCrawlDelayMs?: number; // cap on robots.txt Crawl-delay
    /** Ingestion backpressure: add() is refused once this many URLs are pending. */
    maxPending?: number;
    maxDepth?: number;
    defaultPriority?: number;
    /** Discovered links get parent priority minus this. */
    depthPriorityPenalty?: number;
    robotsRetryMs?: number;
    normalize?: NormalizeOptions;
    retry?: RetryPolicyConfig;
    /** If omitted, robots.txt is not consulted. */
    robots?: RobotsPolicy;
    store?: FrontierStore;
    /** Extra URL admission filter (e.g. domain allow-list). Runs after the built-in SSRF host check. */
    urlFilter?: (url: URL) => boolean;
}

export class Frontier implements URLFrontier {
    private readonly now: () => number;
    private readonly leaseTtlMs: number;
    private readonly maxPending: number;
    private readonly maxDepth: number;
    private readonly defaultPriority: number;
    private readonly depthPenalty: number;
    private readonly robotsRetryMs: number;
    private readonly normalizeOpts: NormalizeOptions;
    private readonly robots?: RobotsPolicy | undefined;
    private readonly urlFilter?: ((url: URL) => boolean) | undefined;

    private readonly store: FrontierStore;
    private readonly hosts: HostManager;
    private readonly scheduler = new HostScheduler();
    private readonly leases: LeaseManager;
    private readonly retry: RetryPolicy;

    private readonly stateCounts: Record<CrawlState, number> = { queued: 0, leased: 0, fetched: 0, failed: 0, deferred: 0 };
    private readonly counters = {
        discovered: 0,
        duplicates: 0,
        invalid: 0,
        rejected: 0,
        backpressure: 0,
        claimed: 0,
        retried: 0,
        expiredLeases: 0,
        robotsDisallowed: 0,
        queueWaitTotalMs: 0,
    };

    constructor(cfg: FrontierConfig = {}) {
        this.now = cfg.now ?? Date.now;
        this.leaseTtlMs = cfg.leaseTtlMs ?? 60_000;
        this.maxPending = cfg.maxPending ?? 1_000_000;
        this.maxDepth = cfg.maxDepth ?? 20;
        this.defaultPriority = cfg.defaultPriority ?? 5;
        this.depthPenalty = cfg.depthPriorityPenalty ?? 1;
        this.robotsRetryMs = cfg.robotsRetryMs ?? 60_000;
        this.normalizeOpts = cfg.normalize ?? {};
        this.robots = cfg.robots;
        this.urlFilter = cfg.urlFilter;

        this.store = cfg.store ?? new InMemoryFrontierStore();
        this.retry = new RetryPolicy(cfg.retry);
        this.leases = new LeaseManager(this.leaseTtlMs);
        this.hosts = new HostManager(
            {
                maxConcurrency: cfg.maxConcurrencyPerHost ?? 2,
                crawlDelayMs: cfg.defaultCrawlDelayMs ?? 1_000,
                maxCrawlDelayMs: cfg.maxCrawlDelayMs ?? 60_000,
                robotsEnabled: cfg.robots !== undefined,
            },
            (entry) => this.setState(entry, "queued"), // a delayed entry became due
        );
    }

    async add(url: string, options: AddOptions = {}): Promise<AddResult> {
        return this.addSync(url, options);
    }

    /**
     * Returns a leased URL, or null if nothing is eligible right now. Use nextEligibleAt() to
     * decide how long to sleep before polling again.
     */
    async claimNext(workerId: string): Promise<Lease | null> {
        this.reapExpiredLeases();
        const now = this.now();

        for (;;) {
            // Level 1: choose a host whose time has come.
            const hostId = this.scheduler.popEligible(now);
            if (hostId === null) return null;
            const host = this.hosts.get(hostId)!;
            const queue = this.hosts.queue(hostId)!;

            if (host.robotsStatus !== "ready") {
                // Not rescheduled here: finishing the robots load reschedules the host.
                if (host.robotsStatus === "unknown" || host.robotsStatus === "failed") this.startRobotsFetch(host);
                continue;
            }
            // The schedule can be stale (state changed since it was computed); re-check, don't trust.
            if (host.inFlight >= host.maxConcurrency || now < host.nextAllowedAt) {
                this.reschedule(host);
                continue;
            }

            // Level 2: choose the best due URL on that host.
            const entry = queue.popReady(now);
            if (!entry) {
                this.reschedule(host);
                continue;
            }
            host.pendingCount--;

            if (!this.hosts.isAllowed(host.id, entry.canonicalUrl)) {
                this.counters.robotsDisallowed++;
                this.fail(entry, "disallowed by robots.txt"); // never reaches the Fetcher
                this.reschedule(host);
                continue;
            }

            entry.attempts++;
            this.setState(entry, "leased");
            const lease = this.leases.grant(entry, workerId, now);
            entry.lease = { workerId, token: lease.token, expiresAt: lease.expiresAt };

            host.inFlight++;
            host.nextAllowedAt = now + host.crawlDelayMs; // delay governs when requests START
            this.counters.claimed++;
            this.counters.queueWaitTotalMs += Math.max(0, now - entry.nextAttemptAt);
            this.reschedule(host);
            return lease;
        }
    }

    /**
     * Record the outcome of a fetch. Throws StaleLeaseError if the lease expired and was reclaimed
     * (token mismatch). A lease that is past its expiry but not yet reaped/re-claimed is still
     * accepted: nobody else holds the URL, so the work is valid.
     */
    async acknowledge(lease: Lease, result: CrawlResult): Promise<void> {
        const entry = this.requireActive(lease);
        const now = this.now();
        const host = this.hosts.get(entry.hostId)!;
        const queue = this.hosts.queue(entry.hostId)!;

        this.leases.release(lease);
        delete entry.lease;
        host.inFlight--; // always, regardless of outcome
        host.lastCrawledAt = now;

        const decision = this.retry.decide(result, entry.attempts);
        switch (decision.kind) {
            case "fetched":
                this.setState(entry, "fetched");
                break;
            case "failed":
                this.fail(entry, decision.reason);
                break;
            case "retry":
                this.counters.retried++;
                entry.lastError = errorText(result);
                this.requeue(entry, host, queue, "queued", now + decision.delayMs, now);
                break;
            case "deferred":
                entry.attempts--; // a deferral isn't the URL's fault
                entry.lastError = result.outcome === "deferred" ? result.reason : undefined;
                this.requeue(entry, host, queue, "deferred", now + decision.delayMs, now);
                break;
        }

        // Host-level backpressure: a throttled/unhealthy host slows down for ALL its URLs.
        host.nextAllowedAt = Math.max(host.nextAllowedAt, now + this.hostBackoff(result, decision));
        this.reschedule(host);

        // Feed discovered URLs back in (after host state is consistent).
        if (result.outcome === "success") {
            for (const link of result.discoveredLinks ?? []) {
                this.addSync(link, {
                    baseUrl: entry.canonicalUrl,
                    depth: entry.depth + 1,
                    priority: entry.priority - this.depthPenalty,
                });
            }
        } else if (result.outcome === "redirect") {
            // Target is treated as a new URL: own normalization, SSRF check, dedup, host policy, robots.
            this.addSync(result.location, { baseUrl: entry.canonicalUrl, depth: entry.depth, priority: entry.priority });
        }
    }

    /** Give a URL back without a verdict (e.g. worker shutting down). Does not consume an attempt. */
    async release(lease: Lease, reason: string): Promise<void> {
        const entry = this.requireActive(lease);
        const now = this.now();
        const host = this.hosts.get(entry.hostId)!;
        this.leases.release(lease);
        delete entry.lease;
        host.inFlight--;
        entry.attempts--;
        entry.lastError = `released: ${reason}`;
        this.requeue(entry, host, this.hosts.queue(entry.hostId)!, "queued", now, now);
        this.reschedule(host);
    }

    /** Heartbeat for long fetches. Use the returned lease from then on. */
    async renewLease(lease: Lease): Promise<Lease> {
        const renewed = this.leases.renew(lease, this.now());
        if (!renewed) 
            throw new StaleLeaseError(lease);

        this.store.get(lease.entryId)!.lease = { workerId: renewed.workerId, token: renewed.token, expiresAt: renewed.expiresAt };
        return renewed;
    }

    /** Requeues (or fails) every URL whose lease has expired. Returns how many were recovered. */
    reapExpiredLeases(): number {
        const now = this.now();
        const ids = this.leases.collectExpired(now);
        for (const id of ids) {
            const entry = this.store.get(id)!;
            const host = this.hosts.get(entry.hostId)!;
            delete entry.lease;
            host.inFlight--;
            this.counters.expiredLeases++;
            entry.lastError = "lease expired";

            if (entry.attempts >= this.retry.maxAttempts) 
                this.fail(entry, "lease expired too many times");
            else 
                this.requeue(entry, host, this.hosts.queue(entry.hostId)!, "queued", now, now);

            this.reschedule(host);
        }
        return ids.length;
    }

    /** When the next host becomes eligible (ms epoch), or null if nothing is scheduled. */
    nextEligibleAt(): number | null {
        return this.scheduler.nextEligibleAt();
    }

    inspectHost(hostId: string): Readonly<HostRecord> | undefined {
        return this.hosts.get(hostId);
    }

    inspectEntry(url: string): Readonly<FrontierEntry> | undefined {
        const canonical = normalizeUrl(url, undefined, this.normalizeOpts);
        return canonical ? this.store.get(hashUrl(canonical)) : undefined;
    }

    async getStats(): Promise<FrontierStats> {
        let activeHosts = 0;
        for (const h of this.hosts.all()) 
            if (h.pendingCount > 0 || h.inFlight > 0) 
                activeHosts++;

        const c = this.counters;
        return {
            pending: this.stateCounts.queued + this.stateCounts.deferred,
            leased: this.stateCounts.leased,
            fetched: this.stateCounts.fetched,
            failed: this.stateCounts.failed,
            deferred: this.stateCounts.deferred,
            totalHosts: this.hosts.size,
            activeHosts,
            scheduledHosts: this.scheduler.size,
            activeLeases: this.leases.size,
            discovered: c.discovered,
            duplicates: c.duplicates,
            invalid: c.invalid,
            rejected: c.rejected,
            backpressureRejections: c.backpressure,
            claimed: c.claimed,
            retried: c.retried,
            expiredLeases: c.expiredLeases,
            robotsDisallowed: c.robotsDisallowed,
            avgQueueWaitMs: c.claimed ? c.queueWaitTotalMs / c.claimed : 0,
            heapUsedBytes: process.memoryUsage().heapUsed,
        };
    }

    /**
     * Cross-checks the core invariants. Returns human-readable violations (empty = healthy).
     * Cheap enough for tests and periodic self-checks.
     */
    checkInvariants(): string[] {
        const problems: string[] = [];
        const perHost = new Map<string, number>();
        const seen = new Set<string>();

        for (const lease of this.leases.leases()) {
            if (seen.has(lease.entryId)) problems.push(`entry ${lease.url} has two active leases`);
            seen.add(lease.entryId);
            perHost.set(lease.hostId, (perHost.get(lease.hostId) ?? 0) + 1);
            const e = this.store.get(lease.entryId);
            if (!e || e.state !== "leased") 
                problems.push(`lease for ${lease.url} but entry state is ${e?.state}`);
        }

        for (const h of this.hosts.all()) {
            const leased = perHost.get(h.id) ?? 0;
            if (h.inFlight > h.maxConcurrency) problems.push(`${h.id} exceeds concurrency (${h.inFlight}/${h.maxConcurrency})`);
            if (h.inFlight !== leased) problems.push(`${h.id} inFlight=${h.inFlight} but ${leased} active leases`);
            if (h.pendingCount !== this.hosts.queue(h.id)!.size) problems.push(`${h.id} pendingCount out of sync with its queue`);
        }

        if (this.stateCounts.leased !== this.leases.size) 
            problems.push("leased count != active leases");

        return problems;
    }

    // ───────────────────────── internals ─────────────────────────

    private addSync(rawUrl: string, options: AddOptions): AddResult {
        const now = this.now();
        const depth = options.depth ?? 0;
        if (depth > this.maxDepth) {
            this.counters.rejected++;
            return "rejected";
        }

        const canonicalUrl = normalizeUrl(rawUrl, options.baseUrl, this.normalizeOpts);
        if (!canonicalUrl) {
            this.counters.invalid++;
            return "invalid";
        }
        const parsed = new URL(canonicalUrl);
        if (!isPublicHostname(parsed.hostname) || (this.urlFilter && !this.urlFilter(parsed))) {
            this.counters.rejected++;
            return "rejected";
        }

        const urlHash = hashUrl(canonicalUrl);
        if (this.store.has(urlHash)) {
            this.counters.duplicates++;
            return "duplicate";
        }

        if (this.stateCounts.queued + this.stateCounts.deferred >= this.maxPending) {
            this.counters.backpressure++;
            return "backpressure";
        }

        const { host, queue, created } = this.hosts.getOrCreate(parsed);
        if (created && this.robots) 
            this.startRobotsFetch(host); // warm robots.txt before the first claim

        const entry: FrontierEntry = {
            id: urlHash,
            url: new URL(rawUrl.trim(), options.baseUrl).href,
            canonicalUrl,
            urlHash,
            hostId: host.id,
            priority: options.priority ?? this.defaultPriority,
            depth,
            state: "queued",
            discoveredAt: now,
            scheduledAt: now,
            attempts: 0,
            nextAttemptAt: now,
        };
        
        this.store.put(entry);
        this.stateCounts.queued++;
        host.pendingCount++;
        queue.push(entry, now);
        this.counters.discovered++;
        this.reschedule(host);
        return "added";
    }

    private requeue(entry: FrontierEntry, host: HostRecord, queue: HostQueue, state: "queued" | "deferred", at: number, now: number): void {
        entry.nextAttemptAt = at;
        entry.scheduledAt = at;
        this.setState(entry, state);
        host.pendingCount++;
        queue.push(entry, now);
    }

    private reschedule(host: HostRecord): void {
        const at = nextEligibleAt(host, this.hosts.queue(host.id)!);
        if (at === null) 
            this.scheduler.unschedule(host.id);

        else this.scheduler.schedule(host.id, at);
    }

    private startRobotsFetch(host: HostRecord): void {
        if (!this.robots || host.robotsStatus === "fetching") 
            return;

        host.robotsStatus = "fetching";
        this.reschedule(host); // removes it from the scheduler while loading
        this.robots.load(host.origin).then(
            (rules) => this.hosts.setRobots(host, rules),
            () => {
                host.robotsStatus = "failed"; // retried after a pause
                host.nextAllowedAt = Math.max(host.nextAllowedAt, this.now() + this.robotsRetryMs);
            },
        ).then(() => this.reschedule(host));
    }

    private requireActive(lease: Lease): FrontierEntry {
        if (!this.leases.isActive(lease)) throw new StaleLeaseError(lease);
        return this.store.get(lease.entryId)!;
    }

    private setState(entry: FrontierEntry, next: CrawlState): void {
        this.stateCounts[entry.state]--;
        entry.state = next;
        this.stateCounts[next]++;
    }

    private fail(entry: FrontierEntry, reason: string): void {
        entry.lastError = reason;
        this.setState(entry, "failed");
    }

    private hostBackoff(result: CrawlResult, decision: ReturnType<RetryPolicy["decide"]>): number {
        if (result.outcome === "retryable_failure") {
        if (result.retryAfterMs !== undefined) return Math.min(result.retryAfterMs, this.retry.maxDelayMs); // honour Retry-After
        if ((result.statusCode === 429 || result.statusCode === 503) && decision.kind === "retry") return decision.delayMs;
        } else if (result.outcome === "deferred" && decision.kind === "deferred") {
        return decision.delayMs;
        }
        return 0;
    }
}