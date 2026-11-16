import { type CrawlerConfig, resolveCrawlerConfig } from "./config.ts";
import { Crawler } from "./crawler.ts";
import { type HttpClient, UndiciHttpClient } from "./http-fetch/http-client.ts";
import {
    type CrawlerBlobDocuments,
    type CrawledDocumentMessage,
    type DocumentStore,
    type MessageQueueProducer,
    InMemoryDocumentStore,
    QueueingDocumentStore,
} from "@search/infra";
import { HtmlProcessor } from "./processor/html-parser.ts";
import { ImageProcessor } from "./processor/image-parser.ts";
import { ProcessorRouter } from "./processor/processor-router.ts";
import { XmlProcessor } from "./processor/xml-parser.ts";
import type { ContentKind, DocumentProcessor } from "./types.ts";
import { Frontier, type FrontierConfig } from "./url-frontier/frontier.ts";
import { HttpRobotsPolicy } from "./url-frontier/policies/robots-policy.ts";

export interface CreateCrawlerOptions extends CrawlerConfig {
    frontier?: FrontierConfig;
    documentStore?: DocumentStore;
    /** Provide these together to persist crawls and publish blob references for indexing. */
    blobDocuments?: CrawlerBlobDocuments;
    documentQueue?: MessageQueueProducer<CrawledDocumentMessage>;
    /** Override or extend the built-in HTML, XML, and image processors. */
    processors?: Partial<Record<ContentKind, DocumentProcessor>>;
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
        documentQueue,
        processors,
        ...crawlerConfig
    } = options;
    const config = resolveCrawlerConfig(crawlerConfig);
    if (Boolean(blobDocuments) !== Boolean(documentQueue)) {
        throw new Error("blobDocuments and documentQueue must be provided together");
    }
    if (providedDocumentStore && documentQueue) {
        throw new Error("Provide either documentStore or blobDocuments with documentQueue, not both");
    }
    const documentStore = providedDocumentStore ??
        (blobDocuments && documentQueue
            ? new QueueingDocumentStore(blobDocuments, documentQueue)
            : new InMemoryDocumentStore());
    const processor = new ProcessorRouter({
        html: new HtmlProcessor(config),
        xml: new XmlProcessor(config),
        image: new ImageProcessor(),
        ...processors,
    });
    processor.assertSupports(config.supportedKinds);

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