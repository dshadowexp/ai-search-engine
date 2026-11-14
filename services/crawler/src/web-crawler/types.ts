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

export interface CrawledDocument {
    url: string;
    canonicalUrl?: string;
    title: string | null;
    description: string | null;
    textContent: string;
    language: string | null;
    links: string[];
    fetchedAt: Date;
}

export interface MainCrawlResult {
    url: string;
    status: "success" | "skipped" | "failed";
    document?: CrawledDocument;
    error?: string;
    discoveredUrls: string[];
}

// ---------------------------------- Fetch ---------
export interface FetchOptions {
    timeoutMs: number;
    maxResponseBytes: number;
    maxRedirects: number;
}

export interface FetchResponse {
    requestedUrl: string;
    finalUrl: string;
    statusCode: number;
    headers: Headers;
    body: Uint8Array;
    contentType: string | null;
}

export interface HttpClient {
    fetch(
        url: string,
        options: FetchOptions
    ): Promise<FetchResponse>;
}