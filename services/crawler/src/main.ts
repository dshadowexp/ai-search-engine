import { loadConfig } from "@search/core";
import {
    LogStream,
    S3BlobStore,
    SqsMessageQueue,
} from "@search/infra";
import { createCrawler } from "./setup.ts";
import { envSchema } from "./config/env-schema.ts";
import { type CrawledDocumentMessage, crawledDocumentMessageSchema } from "@search/core";
import { CrawlerBlobDocumentStore } from "./storage/blob-document-store.ts";

async function startCrawler() {
    const config = loadConfig(envSchema);

    LogStream.getInstance().addStream(process.stdout);

    const documentStore = new CrawlerBlobDocumentStore({
        keyPrefix: "crawleddocuments",
        blobs: new S3BlobStore({
            bucket: config.s3Bucket,
            region: config.s3Region,
            ...(config.s3Endpoint ? { endpoint: config.s3Endpoint } : { }),
            ownsClient: true,
        }),
    });

    const indexQueue = new SqsMessageQueue<CrawledDocumentMessage>(config.sqsQueueUrl, {
        schema: crawledDocumentMessageSchema,
        region: config.awsRegion,
        ...(config.sqsEndpoint ? { endpoint: config.sqsEndpoint } : { }),
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

    let shutdownPromise: Promise<void> | undefined;
    const shutdown = () => {
        shutdownPromise ??= (async () => {
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

    } catch (error) {
        await shutdown();
        throw error;
    }
}

void startCrawler().catch((error: unknown) => {
    console.error("Crawler failed to start:", error);
    process.exitCode = 1;
});