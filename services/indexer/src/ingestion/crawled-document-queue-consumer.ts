import type { CrawledDocumentMessage } from "@search/infra";
import type { IndexerBlobDocuments } from "@search/infra";
import type { ConsumeOptions, MessageQueueConsumer, QueueConsumer } from "@search/infra";
import type { DocumentIngestor } from "./document-ingestor.ts";

type DocumentIngester = Pick<DocumentIngestor, "ingest">;

/** Loads persisted crawl references and hands their documents to the indexer's normal ingestor. */
export class CrawledDocumentQueueConsumer {
    private readonly consumer: MessageQueueConsumer<CrawledDocumentMessage>;
    private readonly documents: IndexerBlobDocuments;
    private readonly ingestor: DocumentIngester;

    constructor(
        consumer: MessageQueueConsumer<CrawledDocumentMessage>,
        documents: IndexerBlobDocuments,
        ingestor: DocumentIngester,
    ) {
        this.consumer = consumer;
        this.documents = documents;
        this.ingestor = ingestor;
    }

    start(options?: ConsumeOptions): QueueConsumer {
        return this.consumer.consume(async (message) => {
            const document = await this.documents.load(message.document);
            await this.ingestor.ingest(document);
        }, options);
    }
}
