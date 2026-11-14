import type { CheerioAPI } from "cheerio";
import { Logger } from "../infrastructure/logger.ts";
import Fetcher from "./fetcher.ts";
import { normalizeUrl } from "./util.ts";
import type Frontier from "../url-frontier/frontier.ts";
import type { FrontierItem } from "../url-frontier/frontier.ts";

type CrawlerOptions = {
    maxDepth: number;
    maxPages?: number;
    concurrency: number;
    allowedDomains?: string[];
    maxPagesPerDomain?: number;
};

export class Crawler {
    private visited: Set<string>;
    private fetcher: Fetcher;
    private activeWorkers: number;
    private pagesCrawled: number;

    constructor(private readonly frontier: Frontier, private readonly options: CrawlerOptions) {
        this.visited = new Set<string>();
        this.fetcher = new Fetcher();
        this.pagesCrawled = 0;
        this.activeWorkers = 0;
    }

    async seed(urls: string[]) {
        for (const url of urls) {
            this.frontier.enqueue(url);
        }
    }

    async run() {
        const workers = Array.from({ length: this.options.concurrency }, (_, i) =>
            this.workerLoop(i),
        );
        await Promise.all(workers);
        await this.fetcher.close();
    }

    async processTask(task: FrontierItem, workerId: number) {
        this.pagesCrawled++;
        const { url } = task;
        const result = await this.fetcher.fetch(url);
        if (!result) {
            Logger.getInstance().warn(`[worker ${ workerId }] no HTML for ${ task.url }`);
            return;
        }

        const links = this.extractUrls(result, url);
        for (const link of links) {
            if (this.visited.has(link)) continue;
            this.visited.add(link);
            this.frontier.enqueue(link);
        }
    }

    private async workerLoop(workerId: number): Promise<void> {
        while (true) {
            if (this.pagesCrawled >= this.options.maxPages!) return;
        
            const task = await this.frontier.lease(`${workerId}`);
        
            if (!task) {
                if (this.activeWorkers === 0) return;
                // await sleep(50);
                continue;
            }
        
            this.activeWorkers++;
            try {
                await this.processTask(task, workerId);
            } finally {
                this.activeWorkers--;
            }
        }
    }
  
    /**
     * Extracts all URLs from the provided HTML content.
     * 
     * @param html 
     * @param baseUrl 
     * @returns 
     */
    extractUrls($: CheerioAPI, baseUrl: string): string[] {
        const urls: string[] = [];

        try {
            for (const element of $("a[href]").toArray()) {
                const href = $(element).attr("href");
                if (href) {
                    const trimmedHref = href.trim();
                    const normalizedUrl = normalizeUrl(trimmedHref, baseUrl);
                    urls.push(normalizedUrl);
                }
            }
        } catch (error) {
            Logger.getInstance().error(`Error occurred while extracting URLs: ${error}`);
        }

        return urls;
    }
}