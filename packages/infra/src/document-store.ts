import type { CrawledDocument } from "@search/core";
import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand
} from "@aws-sdk/client-s3";

/**
 * Where crawled documents go. save() MUST be idempotent (keyed by document.url): a crash
 * between save() and acknowledge() means the URL is crawled again and saved again.
 */
export interface DocumentStore {
    save(document: CrawledDocument, key?: string | undefined): Promise<void>;
    get(url: string): Promise<CrawledDocument | undefined>;
}


const s3 = new S3Client({
    region: process.env.AWS_REGION || ""
});

export class S3DocumentStore implements DocumentStore {
    async save(document: CrawledDocument, key?: string | undefined): Promise<void> {
        await s3.send(
            new PutObjectCommand({
                Bucket: process.env.DOCUMENT_BUCKET!,
                Key: key,
                Body: JSON.stringify(document),
                ContentType: "application/json",
                Metadata: {
                  "document-id": document.url,
                  "content-hash": document.contentHash
                }
            })
      );
    }
    
    async get(key: string): Promise<CrawledDocument | undefined> {
        const bucket = process.env.DOCUMENT_BUCKET!;
        const result = await s3.send(
            new GetObjectCommand({
                Bucket: bucket,
                Key: key
            })
        );

        const body = await result.Body?.transformToString();

        if (!body) {
            throw new Error(`Empty S3 object: ${key}`);
        }

        const document = JSON.parse(body);

        return document as CrawledDocument;
    }
}

export class InMemoryDocumentStore implements DocumentStore {
    private readonly docs = new Map<string, CrawledDocument>();

    get size(): number {
      return this.docs.size;
    }

    async save(document: CrawledDocument): Promise<void> {
      this.docs.set(document.url, document);
    }

    async get(url: string): Promise<CrawledDocument | undefined> {
      return this.docs.get(url);
    }

    all(): IterableIterator<CrawledDocument> {
      return this.docs.values();
    }
}