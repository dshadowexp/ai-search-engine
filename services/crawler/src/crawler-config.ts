import type { NetworkPolicy } from "./http-fetch/http-client.ts";
import { ContentKind } from "./types.ts";

export interface CrawlerConfig {
    /** Descriptive user-agent with a contact/policy URL, e.g. "MyBot/1.0 (+https://example.com/bot)". */
    userAgent: string;
    /**
     * Injectable clock (ms). Pass the same clock to the Frontier: workers sleep until
     * frontier.nextEligibleAt(), which is expressed in the frontier's time.
     */
    now?: () => number;
    /** Simultaneous jobs = global HTTP concurrency. Per-host limits and delays belong to the frontier. */
    concurrency?: number;
    /** Total deadline per request, including reading the body. */
    timeoutMs?: number;
    /** Cap on the DECOMPRESSED body; larger bodies are truncated, not rejected. */
    maxResponseBytes?: number;
    supportedKinds?: ContentKind[];
    maxLinksPerPage?: number;
    maxTextChars?: number;
    /** Honour <meta name="robots"> noindex/nofollow/none. */
    respectMetaRobots?: boolean;
    /** Skip <a rel="nofollow"> links. Off by default. */
    respectNofollow?: boolean;
    /** How long an idle worker sleeps when the frontier has nothing scheduled. */
    idlePollMs?: number;
    /** DNS resolution and address policy: the SSRF boundary. Override only in tests. */
    network?: NetworkPolicy;
}

export type ResolvedCrawlerConfig = Required<Omit<CrawlerConfig, "network">> & { network?: NetworkPolicy };

export function resolveCrawlerConfig(cfg: CrawlerConfig): ResolvedCrawlerConfig {
    if (!cfg.userAgent.trim()) 
        throw new Error("CrawlerConfig.userAgent is required");
    
    const concurrency = cfg.concurrency ?? 8;
    if (!Number.isInteger(concurrency) || concurrency < 1) 
        throw new Error("CrawlerConfig.concurrency must be a positive integer");
    
    return {
        userAgent: cfg.userAgent,
        now: cfg.now ?? Date.now,
        concurrency,
        timeoutMs: cfg.timeoutMs ?? 15_000,
        maxResponseBytes: cfg.maxResponseBytes ?? 5 * 1024 * 1024,
        supportedKinds: cfg.supportedKinds ?? ["html"],
        maxLinksPerPage: cfg.maxLinksPerPage ?? 500,
        maxTextChars: cfg.maxTextChars ?? 500_000,
        respectMetaRobots: cfg.respectMetaRobots ?? true,
        respectNofollow: cfg.respectNofollow ?? false,
        idlePollMs: cfg.idlePollMs ?? 250,
        ...(cfg.network !== undefined ? { network: cfg.network } : {}),
    };
}