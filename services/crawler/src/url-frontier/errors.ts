import type { CrawlResult } from "../types.ts";
import type { Lease } from "./types.ts";

export class StaleLeaseError extends Error {
    constructor(lease: Lease) {
        super(`Lease for ${lease.url} (worker ${lease.workerId}) is no longer valid`);
        this.name = "StaleLeaseError";
    }
}

export function errorText(r: CrawlResult): string | undefined {
    return r.outcome === "retryable_failure" ? (r.error ?? (r.statusCode ? `HTTP ${r.statusCode}` : undefined)) : undefined;
}