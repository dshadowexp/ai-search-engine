import type { CrawlResult } from "../types.js";
import type { HttpResponse } from "../types.js";

export type Classification =
    /** A 2xx with content: carry on to validation and processing. */
    | { kind: "proceed" }
    /** The status alone settles it; report this to the frontier. */
    | { kind: "done"; result: CrawlResult };

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * Maps an HTTP status to a frontier outcome. Retry scheduling is NOT done here: we only say
 * "retryable" (with the server's Retry-After); the frontier owns backoff, limits and host slowdown.
 */
export function classifyResponse(res: Pick<HttpResponse, "url" | "statusCode" | "headers">, now: number): Classification {
    const s = res.statusCode;

    if (REDIRECTS.has(s)) {
        const location = res.headers.get("location");
        if (!location) return done({ outcome: "permanent_failure", statusCode: s, error: `HTTP ${s} without Location` });
        try {
            // Hand the frontier an absolute URL; it re-validates it as a brand new URL.
            return done({ outcome: "redirect", location: new URL(location, res.url).href });
        } catch {
            return done({ outcome: "permanent_failure", statusCode: s, error: `HTTP ${s} with invalid Location` });
        }
    }

    if (s === 204 || s === 205) 
        return done({ outcome: "success" });
    
    if (s >= 200 && s < 300) 
        return { kind: "proceed" };

    if (s === 408 || s === 429 || s >= 500) {
        const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"), now);
        return done({
            outcome: "retryable_failure",
            statusCode: s,
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
            error: `HTTP ${s}`,
        });
    }

    if (s === 401 || s === 403) 
        return done({ outcome: "permanent_failure", statusCode: s, error: `HTTP ${s} (inaccessible)` });
    
    if (s === 304) 
        return done({ outcome: "permanent_failure", statusCode: s, error: "HTTP 304 but no conditional request was sent" });
    
    return done({ outcome: "permanent_failure", statusCode: s, error: `HTTP ${s}` });
}

/** Retry-After: delta-seconds or an HTTP date. Returns ms, or undefined if absent/unparseable. */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
    if (!value) 
        return undefined;

    const v = value.trim();
    if (/^\d+$/.test(v)) 
        return Number(v) * 1000;

    const at = Date.parse(v);
    return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

const done = (result: CrawlResult): Classification => ({ kind: "done", result });