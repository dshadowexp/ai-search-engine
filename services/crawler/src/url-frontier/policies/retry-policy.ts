import type { CrawlResult } from "../../types.ts";

export interface RetryPolicyConfig {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    defaultDeferMs?: number;
}

export type RetryDecision =
    | { kind: "fetched" }
    | { kind: "retry"; delayMs: number }
    | { kind: "deferred"; delayMs: number }
    | { kind: "failed"; reason: string };

export class RetryPolicy {
    readonly maxAttempts: number;
    readonly maxDelayMs: number;
    private readonly baseDelayMs: number;
    private readonly defaultDeferMs: number;

    constructor(cfg: RetryPolicyConfig = {}) {
        this.maxAttempts = cfg.maxAttempts ?? 5;
        this.baseDelayMs = cfg.baseDelayMs ?? 2_000;
        this.maxDelayMs = cfg.maxDelayMs ?? 60 * 60 * 1000;
        this.defaultDeferMs = cfg.defaultDeferMs ?? 60_000;
    }

    /** `attempts` already includes the attempt being reported. */
    decide(result: CrawlResult, attempts: number): RetryDecision {
        switch (result.outcome) {
        case "success":
        case "redirect":
            return { kind: "fetched" };
        case "permanent_failure":
            return { kind: "failed", reason: result.error ?? `permanent failure${result.statusCode ? ` (HTTP ${result.statusCode})` : ""}` };
        case "deferred":
            return { kind: "deferred", delayMs: Math.min(result.retryAfterMs ?? this.defaultDeferMs, this.maxDelayMs) };
        case "retryable_failure": {
            if (attempts >= this.maxAttempts) {
            return { kind: "failed", reason: `retry limit reached: ${result.error ?? result.statusCode ?? "unknown error"}` };
            }
            const backoff = this.baseDelayMs * 2 ** (attempts - 1); // 2s, 4s, 8s, ...
            const delayMs = Math.min(result.retryAfterMs ?? backoff, this.maxDelayMs);
            return { kind: "retry", delayMs };
        }
    }
  }
}
