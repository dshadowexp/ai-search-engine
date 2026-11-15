import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand
} from "@aws-sdk/client-s3";
import { DocumentStore } from "./document-store.ts";
import { CrawledDocument } from "@search/core";

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