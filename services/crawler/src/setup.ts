import { type CrawlerConfig, resolveCrawlerConfig } from "./config.ts";
import { Crawler } from "./crawler.ts";
import { type HttpClient, UndiciHttpClient } from "./http-fetch/http-client.ts";
import { type DocumentStore, InMemoryDocumentStore } from "@search/infra";
import { HtmlProcessor } from "./processor/html-parser.ts";
import type { DocumentProcessor } from "./types.ts";
import { Frontier, type FrontierConfig } from "./url-frontier/frontier.ts";
import { HttpRobotsPolicy } from "./url-frontier/policies/robots-policy.ts";

export interface CreateCrawlerOptions extends CrawlerConfig {
    frontier?: FrontierConfig;
    documentStore?: DocumentStore;
    processor?: DocumentProcessor;
}

/**
 * Wires a frontier and a crawler together with ONE shared SSRF boundary and clock:
 * robots.txt is fetched through the same safe HTTP client as pages, and both sides agree on time.
 */
export function createCrawler(options: CreateCrawlerOptions) {
    const { frontier: frontierConfig, documentStore = new InMemoryDocumentStore(), processor, ...crawlerConfig } = options;
    const config = resolveCrawlerConfig(crawlerConfig);

    const httpClient: HttpClient = new UndiciHttpClient({
        userAgent: config.userAgent,
        timeoutMs: config.timeoutMs,
        maxResponseBytes: config.maxResponseBytes,
        ...(config.network !== undefined ? { network: config.network } : {}),
    });
    
    const frontier = new Frontier({
        now: config.now,
        robots: new HttpRobotsPolicy(config.userAgent, httpClient.fetchImpl, config.timeoutMs),
        ...frontierConfig,
    });
    
    const crawler = new Crawler(
        { frontier, httpClient, documentStore, processor: processor ?? new HtmlProcessor(config) },
        crawlerConfig,
    );

    return { crawler, frontier, httpClient, documentStore };
}