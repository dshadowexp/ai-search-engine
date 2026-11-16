import type { AddOptions, AddResult, CrawlResult } from "../types.ts";

/**
 * 
 * urlHash: Efficient deduplication key.
 * canonicalUrl: The normalized representation used for identity.
 * hostId: Associates the URL with its scheduling group.
 * priority: Allows important pages to be crawled earlier.
 * depth: Number of link traversals from a seed URL.
 * attempts: Prevents endless retry loops.
 * lease: Prevents multiple workers from claiming the same URL.
 */
export type CrawlState =
    | "queued"
    | "leased"
    | "fetched"
    | "failed"
    | "deferred";

export interface FrontierEntry {
    id: string;
    url: string;
    canonicalUrl: string;
    urlHash: string;
    hostId: string;

    priority: number;
    depth: number;

    state: CrawlState;

    discoveredAt: number;
    scheduledAt: number;
    attempts: number;
    nextAttemptAt: number;

    lease?: {
        workerId: string;
        token: string;
        expiresAt: number;
    };
    lastError?: string | undefined;
}

/**
 * 
 * 
 */
type RobotStatus = 
    | "unknown"
    | "fetching"
    | "ready"
    | "failed";

export interface HostRecord {
    id: string;
    origin: string;
    pendingCount: number;
    inFlight: number;
    maxConcurrency: number;
    crawlDelayMs: number;
    nextAllowedAt: number;
    robotsStatus: RobotStatus;
    lastCrawledAt?: number;
}


/** 
 * What a worker holds while it fetches a URL. 
 * */
export interface Lease {
    entryId: string;
    url: string; // the canonical URL to fetch
    hostId: string;
    workerId: string;
    token: string;
    expiresAt: number;
    attempt: number;
    depth: number; // link hops from a seed
}

export interface FrontierStore {
    get(id: string): FrontierEntry | undefined;
    has(id: string): boolean;
    put(entry: FrontierEntry): void;
    readonly size: number;
}

/**
 * 
 * 
 */
export interface FrontierStats {
  pending: number; // queued + deferred
  leased: number;
  fetched: number;
  failed: number;
  deferred: number;

  totalHosts: number;
  activeHosts: number; // hosts with pending or in-flight work
  scheduledHosts: number;
  activeLeases: number;

  discovered: number;
  duplicates: number;
  invalid: number;
  rejected: number;
  backpressureRejections: number;
  claimed: number;
  retried: number;
  expiredLeases: number;
  robotsDisallowed: number;
  avgQueueWaitMs: number;

  heapUsedBytes: number;
}

export interface IFrontier {
    add(url: string, options?: AddOptions): Promise<AddResult>;
    claimNext(workerId: string): Promise<Lease | null>;
    acknowledge(lease: Lease, result: CrawlResult): Promise<void>;
    release(lease: Lease, reason: string): Promise<void>;
    renewLease(lease: Lease): Promise<Lease>;
    /** When the next host becomes eligible (ms epoch), or null if nothing is scheduled. */
    nextEligibleAt(): number | null;
    getStats(): Promise<FrontierStats>;
}