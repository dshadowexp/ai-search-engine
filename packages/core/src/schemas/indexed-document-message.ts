import { z } from "zod";

const indexedDocumentReferenceSchema = z.object({
    key: z.string().min(1).max(1024),
    documentId: z.string().regex(/^[a-f0-9]{64}$/),
    version: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const indexedDocumentMessageSchema = z.object({
    schemaVersion: z.literal(1),
    eventType: z.literal("indexer.document.ready_for_semantic_index"),
    eventId: z.string().min(1).max(128),
    document: indexedDocumentReferenceSchema,
}).strict();

export type IndexedDocumentReference = z.infer<typeof indexedDocumentReferenceSchema>;
export type IndexedDocumentMessage = z.infer<typeof indexedDocumentMessageSchema>;

export function createIndexedDocumentMessage(document: IndexedDocumentReference): IndexedDocumentMessage {
    return indexedDocumentMessageSchema.parse({
        schemaVersion: 1,
        eventType: "indexer.document.ready_for_semantic_index",
        eventId: `${document.documentId}@${document.version}`,
        document,
    });
}
