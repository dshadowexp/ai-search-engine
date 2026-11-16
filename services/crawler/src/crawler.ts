import type { AddOptions, AddResult, CrawlerStats } from "./types.ts";
import { sleep } from "@search/core";
import { type CrawlerDependencies, resolveCrawlerConfig, type CrawlerConfig, type ResolvedCrawlerConfig } from "./config.ts";
import { CrawlerWorker } from "./worker.ts";
import { ProcessorRouter } from "./processor/processor-router.ts";
import { HtmlProcessor } from "./processor/html-parser.ts";
import { XmlProcessor } from "./processor/xml-parser.ts";
import { ImageProcessor } from "./processor/image-parser.ts";

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