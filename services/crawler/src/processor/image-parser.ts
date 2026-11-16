import { createHash } from "node:crypto";
import type { CrawledDocument } from "@search/core";
import type { DocumentProcessor, ProcessedPage, ProcessInput } from "../types.ts";

/** Creates a searchable metadata document; it does not perform OCR or image captioning. */
export class ImageProcessor implements DocumentProcessor {
    process(input: ProcessInput): ProcessedPage {
        const fileName = fileNameFromUrl(input.url);
        const mediaType = input.contentType?.split(";")[0]?.trim().toLowerCase() || "image/unknown";
        const textContent = [
            `Image: ${fileName}`,
            `URL: ${input.url}`,
            `Type: ${mediaType}`,
            `Size: ${input.body.byteLength} bytes`,
        ].join("\n");
        const document: CrawledDocument = {
            url: input.url,
            title: fileName,
            description: mediaType,
            headings: [],
            textContent,
            contentHash: createHash("sha256").update(input.body).digest("hex"),
            language: null,
            publishedAt: null,
            modifiedAt: null,
            links: [],
            fetchedAt: input.fetchedAt,
            depth: input.depth,
            truncated: input.truncated,
        };

        return { document, links: [], noindex: false, nofollow: false };
    }
}

function fileNameFromUrl(value: string): string {
    const segment = new URL(value).pathname.split("/").filter(Boolean).at(-1);
    if (!segment) return new URL(value).hostname;

    let decoded = segment;
    try {
        decoded = decodeURIComponent(segment);
    } catch {
        // Keep the original URL segment if it contains malformed escapes.
    }
    return decoded.replace(/\.[^.]+$/, "") || decoded;
}
