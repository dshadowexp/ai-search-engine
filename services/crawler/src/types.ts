import type { CrawledDocument } from "@search/core";

export type AddResult = "added" | "duplicate" | "invalid" | "rejected" | "backpressure";

export interface AddOptions {
  priority?: number;
  depth?: number;
  baseUrl?: string;
}

export interface CrawlTask {
    url: string;
    priority: number;
    depth: number;
    attempts: number;
    availableAt: number;
}

export interface FetchResult {
    url: string;
    statusCode: number;
    headers: Headers;
    body: Buffer;
    contentType: string;
}

export interface ParsedDocument {
    url: string;
    title?: string;
    text: string;
    links: string[];
    metadata: Record<string, string>;
}

export type CrawlResult =
    | { outcome: "success"; discoveredLinks?: string[] }
    /** The fetcher saw a redirect. The target is re-validated as a brand new URL (own host, robots, SSRF checks). */
    | { outcome: "redirect"; location: string }
    | { outcome: "retryable_failure"; statusCode?: number; retryAfterMs?: number; error?: string }
    | { outcome: "permanent_failure"; statusCode?: number; error?: string }
    /** Temporary restriction that isn't the URL's fault; does not consume an attempt. */
    | { outcome: "deferred"; retryAfterMs?: number; reason?: string };

// ------------------------------- Main -------------------------

export interface CrawlJob {
    id: string;
    url: string;
    depth: number;
    parentUrl?: string;
    attempt: number;
}

// export interface CrawledDocument {
//     url: string;
//     canonicalUrl?: string;
//     title: string | null;
//     description: string | null;
//     textContent: string;
//     language: string | null;
//     links: string[];
//     fetchedAt: Date;
// }
export type ContentKind = "html" | "xml" | "pdf" | "json" | "image" | "other";

/** Status line + headers, available before the body is read. */
export interface ResponseHead {
  statusCode: number;
  headers: Headers;
  contentType: string | null;
}

export interface HttpResponse extends ResponseHead {
    /** The URL that was requested. Redirects are never followed here: the frontier re-admits the target. */
    url: string;
    body: Uint8Array;
    /** The body hit maxResponseBytes (measured after decompression) and was cut off. */
    truncated: boolean;
    /** The body was deliberately not downloaded (redirect, or the caller didn't want it). */
    bodySkipped: boolean;
    durationMs: number;
}

export interface ProcessInput {
    url: string;
    kind: ContentKind;
    contentType: string | null;
    body: Uint8Array;
    fetchedAt: number;
    depth: number;
    truncated: boolean;
}

export interface ProcessedPage {
    /** Null when the page asked not to be indexed (meta robots noindex). */
    document: CrawledDocument | null;
    /** Candidate URLs only: the frontier decides admission. Empty when the page said nofollow. */
    links: string[];
    noindex: boolean;
    nofollow: boolean;
}

export interface DocumentProcessor {
    process(input: ProcessInput): ProcessedPage;  
}

export interface CrawlerStats {
    pagesStored: number;
    pagesSkipped: number;
    redirects: number;
    retryableFailures: number;
    permanentFailures: number;
    staleLeases: number;
    shutdownReleases: number;
    internalErrors: number;
    bytesDownloaded: number;
    linksDiscovered: number;
    activeJobs: number;
}
