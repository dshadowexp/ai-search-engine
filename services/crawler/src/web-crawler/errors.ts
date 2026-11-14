import type { CrawlResult } from "./types.ts";

export function errorText(r: CrawlResult): string | undefined {
  return r.outcome === "retryable_failure" ? (r.error ?? (r.statusCode ? `HTTP ${r.statusCode}` : undefined)) : undefined;
}