import { loadConfig } from "@search/core";
import {
    LogStream,
    S3BlobStore,
    SqsMessageQueue,
} from "@search/infra";
import { createCrawler } from "./setup.ts";
import { crawlerEnvSchema } from "./config/crawler.schema.ts";
import { type CrawledDocumentMessage, crawledDocumentMessageSchema } from "./queue/crawled-document-message.ts";
import { CrawlerBlobDocumentStore } from "./storage/blob-document-store.ts";

async function startCrawler() {
    const config = loadConfig(crawlerEnvSchema);

    LogStream.getInstance().addStream(process.stdout);

    const documentStore = new CrawlerBlobDocumentStore({
        blobs: new S3BlobStore({
            bucket: config.s3Bucket,
            region: config.s3Region,
            ...(config.s3Endpoint ? { endpoint: config.s3Endpoint } : {}),
            ownsClient: true,
        }),
    });

    const indexQueue = new SqsMessageQueue<CrawledDocumentMessage>(config.sqsQueueUrl, {
        schema: crawledDocumentMessageSchema,
        region: config.awsRegion,
        ...(new URL(config.sqsQueueUrl).pathname.endsWith(".fifo")
            ? { messageGroupId: (message) => message.document.documentId }
            : {}),
    });
    
    const crawler = createCrawler(
        {
            userAgent: "CruwlBot/1.0 (+https://example.com/bot)",
            documentStore,
            indexQueue,
        },
    );

    let statsTimer: ReturnType<typeof setInterval> | undefined;
    let shutdownPromise: Promise<void> | undefined;
    const shutdown = () => {
        shutdownPromise ??= (async () => {
            if (statsTimer) clearInterval(statsTimer);
            try {
                await crawler.stop();
            } finally {
                await Promise.all([documentStore.close(), indexQueue.close()]);
            }
        })().catch((error: unknown) => {
            LogStream.getInstance().log(
                { error: error instanceof Error ? error.message : String(error) },
                "Crawler shutdown failed",
                true,
            );
            process.exitCode = 1;
        });
        return shutdownPromise;
    };

    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());

    try {
        await crawler.seed([
            // "https://wagslane.dev", 
            "https://toscrape.com",
            // "https://readykare.com"
        ]);
        crawler.start();
        statsTimer = setInterval(async () => {
            LogStream.getInstance().log(await crawler.getStats());
        }, 5000);
        setTimeout(async () => {
            await shutdown();
        }, 20000)
    } catch (error) {
        await shutdown();
        throw error;
    }
}

void startCrawler().catch((error: unknown) => {
    console.error("Crawler failed to start:", error);
    process.exitCode = 1;
});