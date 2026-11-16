import { z } from "zod";

export const crawledDocumentSchema = z.object({
    url: z.string().min(1),
    declaredCanonicalUrl: z.string().optional(),
    title: z.string().nullable(),
    description: z.string().nullable(),
    headings: z.array(z.string()),
    textContent: z.string(),
    contentHash: z.string(),
    language: z.string().nullable(),
    publishedAt: z.number().nullable(),
    modifiedAt: z.number().nullable(),
    links: z.array(z.string()),
    fetchedAt: z.number().int().nonnegative(),
    depth: z.number().int().nonnegative(),
    truncated: z.boolean(),
});

export type CrawledDocument = z.infer<typeof crawledDocumentSchema>;
