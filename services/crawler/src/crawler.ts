import type { AddOptions, AddResult, ContentKind, CrawlerStats } from "./types.ts";
import { type CrawledDocument, type CrawledDocumentMessage, sleep } from "@search/core";
import { CrawlerWorker } from "./worker.ts";
import { ProcessorRouter } from "./processor/processor-router.ts";
import { HtmlProcessor } from "./processor/html-parser.ts";
import { XmlProcessor } from "./processor/xml-parser.ts";
import { ImageProcessor } from "./processor/image-parser.ts";
import { type IFrontier } from "./url-frontier/types.ts";
import type { HttpClient, NetworkPolicy } from "./http-fetch/http-client.ts";
import type { DocumentStore, MessageQueueProducer, SavedDocument } from "@search/infra";

export interface CrawlerDependencies {
    frontier: IFrontier;
    httpClient: HttpClient;
    documentStore: DocumentStore<CrawledDocument, SavedDocument>;
    indexQueue?: MessageQueueProducer<CrawledDocumentMessage> | undefined;
}

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

/** A bounded pool of workers. Global concurrency lives here; per-host limits live in the frontier. */
export class Crawler {
    private readonly config: ResolvedCrawlerConfig;
    private readonly stats: CrawlerStats = {
        pagesStored: 0,
        pagesSkipped: 0,
        redirects: 0,
        retryableFailures: 0,
        permanentFailures: 0,
        staleLeases: 0,
        shutdownReleases: 0,
        internalErrors: 0,
        bytesDownloaded: 0,
        linksDiscovered: 0,
        activeJobs: 0,
    };
    private controller?: AbortController | undefined;
    private running: Promise<void>[] = [];
    private readonly deps: CrawlerDependencies;

    constructor(
        deps: CrawlerDependencies,
        config: CrawlerConfig,
    ) {
        this.config = resolveCrawlerConfig(config);
        this.deps = deps;
        
    }

    async seed(urls: string[], options: AddOptions = {}): Promise<AddResult[]> {
        const results: AddResult[] = [];
        
        for (const url of urls) 
            results.push(await this.deps.frontier.add(url, { priority: 10, ...options }));

        return results;
    }

    start(): void {
        if (this.controller) 
            return;

        const processor = new ProcessorRouter({
            html: new HtmlProcessor(this.config),
            xml: new XmlProcessor(this.config),
            image: new ImageProcessor(),
        });
        
        const controller = (this.controller = new AbortController());
        for (let i = 0; i < this.config.concurrency; i++) {
            const worker = new CrawlerWorker({ ...this.deps, processor }, this.config, `crawler-${process.pid}-${i}`, this.stats);
            this.running.push(worker.run(controller.signal));
        }
    }

    /** Graceful: in-flight jobs are aborted and their leases released (no attempt consumed). */
    async stop(): Promise<void> {
        this.controller?.abort();
        await Promise.allSettled(this.running);
        this.controller = undefined;
        this.running = [];
    }

    /** Resolves when nothing is pending or leased. Hosts stuck behind a failing robots.txt keep it waiting. */
    async waitUntilIdle(options: { pollMs?: number; signal?: AbortSignal } = {}): Promise<void> {
        const pollMs = options.pollMs ?? 50;
        for (;;) {
            const s = await this.deps.frontier.getStats();
            if (s.pending === 0 && s.leased === 0) 
                return;

            if (options.signal?.aborted) 
                return;

            await sleep(pollMs, options.signal);
        }
    }

    async getStats(): Promise<CrawlerStats> {
        return { ...this.stats };
    }
}