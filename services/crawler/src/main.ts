// import { Crawler } from "./crawler/main.ts";
// import Frontier from "./url-frontier/frontier.ts";
// import server from "./http/main.ts";

import { CrawlerConfig, resolveCrawlerConfig } from "./crawler-config.ts";
import { Crawler } from "./crawler.ts";
import { HttpClient, UndiciHttpClient } from "./http-fetch/http-client.ts";
import { type DocumentStore, InMemoryDocumentStore } from "@search/shared";
import { HtmlProcessor } from "./processor/html-parser.ts";
import { DocumentProcessor } from "./types.ts";
import { Frontier, FrontierConfig } from "./url-frontier/frontier.ts";
import { HttpRobotsPolicy } from "./url-frontier/policies/robots-policy.ts";

// async function startup() {
//     const frontier = new Frontier();
//     const crawler = new Crawler(frontier, {
//         maxDepth: 1,
//         maxPages: 1,
//         concurrency: 1,
//         allowedDomains: ["wagslane.dev", "toscrape.com"],
//         maxPagesPerDomain: 1,
//     });
 
//     crawler.seed(["http://wagslane.dev", "https://books.toscrape.com"]);

//     server.listen(3030, () => {
//         console.log("server is listening on localhost:3030")
//     });

//     crawler.run();
// }

// startup();

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