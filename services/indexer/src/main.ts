import { type CrawledDocumentMessage, crawledDocumentMessageSchema, loadConfig } from "@search/core";
import { envSchema } from "./config/env-schema.ts";
import { LogStream, S3BlobStore, SqsMessageQueue } from "@search/infra";
import { IndexerBlobDocumentStore } from "./storage/blob-document-store.ts";
import { GrpcServer } from "./grpc/server.ts";
import {
    lexicalSearchServiceDefinition,
    lexicalSearchServiceImplementation,
} from "./grpc/lexical-search-service.ts";
import { createIndexingPipeline } from "./setup.ts";

const config = loadConfig(envSchema);

async function consumeCrawledDocumentMessages() {
    LogStream.getInstance().addStream(process.stdout);

    const documentStore = new IndexerBlobDocumentStore({
        keyPrefix: "crawleddocuments",
        blobs: new S3BlobStore({
            bucket: config.s3Bucket,
            region: config.s3Region,
            ...(config.s3Endpoint ? { endpoint: config.s3Endpoint } : { }),
            ownsClient: true,
        }),
    });

    const indexQueue = new SqsMessageQueue<CrawledDocumentMessage>(config.indexedSqsQueueUrl, {
        schema: crawledDocumentMessageSchema,
        region: config.awsRegion,
        ...(config.sqsEndpoint ? { endpoint: config.sqsEndpoint } : { }),
        ...(new URL(config.indexedSqsQueueUrl).pathname.endsWith(".fifo")
            ? { messageGroupId: (message) => message.document.documentId }
            : {}),
    });

    const semanticQueue = new SqsMessageQueue<CrawledDocumentMessage>(config.semanticSqsQueueUrl, {
        schema: crawledDocumentMessageSchema,
        region: config.awsRegion,
        ...(config.sqsEndpoint ? { endpoint: config.sqsEndpoint } : { }),
        ...(new URL(config.semanticSqsQueueUrl).pathname.endsWith(".fifo")
            ? { messageGroupId: (message) => message.document.documentId }
            : {}),
    });

    const { pipeline, documentConsumer, searchService } = createIndexingPipeline({
        blobDocuments: documentStore,
        documentQueue: indexQueue,
    });
    if (!documentConsumer) throw new Error("Indexer document consumer was not created");

    pipeline.start();
    const queueConsumer = documentConsumer.start();

    let shutdownPromise: Promise<void> | undefined;
    const shutdown = () => {
        shutdownPromise ??= (async () => {

            try {
                await Promise.all([queueConsumer.stop(), pipeline.stop()]);
            } finally {
                await Promise.all([
                    documentStore.close(), 
                    indexQueue.close(), 
                    semanticQueue.close()
                ]);
            }
        })().catch((error: unknown) => {
            LogStream.getInstance().log(
                { error: error instanceof Error ? error.message : String(error) },
                "Indexer shutdown failed",
                true,
            );
            process.exitCode = 1;
        });
        return shutdownPromise;
    };


    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    return searchService;
}

async function serveGrpc(searchService: ReturnType<typeof createIndexingPipeline>["searchService"]) {
    const grpcServer = new GrpcServer();

    grpcServer.addService(
        lexicalSearchServiceDefinition,
        lexicalSearchServiceImplementation(searchService),
    );

    let shutdownPromise: Promise<void> | undefined;
    const shutdown = () => {
        shutdownPromise ??= (async () => {
            await grpcServer.stop();
        })().catch((error: unknown) => {
            LogStream.getInstance().log(
                { error: error instanceof Error ? error.message : String(error) },
                "Indexer shutdown failed",
                true,
            );
            process.exitCode = 1;
        });
        return shutdownPromise;
    }

    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());

    try {
        await grpcServer.start(config.grpcPort);
    } catch (error) {
        await shutdown();
        throw error;
    }
}

async function startUp() {
    const searchService = await consumeCrawledDocumentMessages();
    await serveGrpc(searchService);
}

startUp().catch(console.error)