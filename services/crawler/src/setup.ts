import { type CrawlerConfig, resolveCrawlerConfig } from "./config.ts";
import { Crawler } from "./crawler.ts";
import { type HttpClient, UndiciHttpClient } from "./http-fetch/http-client.ts";
import type {
    SavedDocument,
    CrawlerBlobDocuments,
    DocumentStore,
    MessageQueueProducer,
} from "@search/infra";
import { InMemoryFrontier, type FrontierConfig } from "./url-frontier/frontier.ts";
import { HttpRobotsPolicy } from "./url-frontier/policies/robots-policy.ts";
import type { CrawledDocument } from "@search/core";
import type { CrawledDocumentMessage } from "./queue/crawled-document-message.ts";
import { InMemoryDocumentStore } from "./storage/in-memory-document-store.ts";

export interface CreateCrawlerOptions extends CrawlerConfig {
    frontier?: FrontierConfig;
    documentStore?: DocumentStore<CrawledDocument, SavedDocument>;
    /** Provide these together to persist crawls and publish blob references for indexing. */
    blobDocuments?: CrawlerBlobDocuments;
    indexQueue?: MessageQueueProducer<CrawledDocumentMessage>;
}

/**
 * Wires a frontier and a crawler together with ONE shared SSRF boundary and clock:
 * robots.txt is fetched through the same safe HTTP client as pages, and both sides agree on time.
 */
export function createCrawler(options: CreateCrawlerOptions) {
    const {
        frontier: frontierConfig,
        documentStore: providedDocumentStore,
        blobDocuments,
        indexQueue,
        ...crawlerConfig
    } = options;
    const config = resolveCrawlerConfig(crawlerConfig);

    const documentStore = providedDocumentStore ?? new InMemoryDocumentStore();

    const httpClient: HttpClient = new UndiciHttpClient({
        userAgent: config.userAgent,
        timeoutMs: config.timeoutMs,
        maxResponseBytes: config.maxResponseBytes,
        ...(config.network !== undefined ? { network: config.network } : {}),
    });
    
    const frontier = new InMemoryFrontier({
        now: config.now,
        robots: new HttpRobotsPolicy(config.userAgent, httpClient.fetchImpl, config.timeoutMs),
        ...frontierConfig,
    });
    
    const crawler = new Crawler(
        { frontier, httpClient, documentStore, indexQueue: indexQueue!},
        crawlerConfig,
    );

    return crawler;
}