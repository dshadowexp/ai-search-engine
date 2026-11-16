import { createHash } from "node:crypto";
import { z } from "zod";

const documentReferenceSchema = z.object({
    key: z.string().min(1).max(1024),
    documentId: z.string().regex(/^[a-f0-9]{64}$/),
    fetchedAt: z.number().int().nonnegative(),
}).strict();

export const crawledDocumentMessageSchema = z.object({
    schemaVersion: z.literal(1),
    eventType: z.literal("crawler.document.persisted"),
    /** Stable across publish retries, but distinct for each fetch of the same URL. */
    eventId: z.string().min(1).max(128),
    document: documentReferenceSchema,
}).strict();

export type CrawledDocumentMessage = z.infer<typeof crawledDocumentMessageSchema>;
export type CrawledDocumentReference = z.infer<typeof documentReferenceSchema>;

export function createCrawledDocumentMessage(document: CrawledDocumentReference): CrawledDocumentMessage {
    return crawledDocumentMessageSchema.parse({
        schemaVersion: 1,
        eventType: "crawler.document.persisted",
        eventId: createHash("sha256")
            .update(document.key)
            .update("\0")
            .update(String(document.fetchedAt))
            .digest("hex"),
        document: {
            key: document.key,
            documentId: document.documentId,
            fetchedAt: document.fetchedAt,
        },
    });
}
