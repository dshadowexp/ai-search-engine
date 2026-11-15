import type { CrawledDocument } from "@search/core";

export function crawled(url: string, textContent: string, fetchedAt: number): CrawledDocument {
    return {
        url,
        title: "Test document",
        description: null,
        headings: [],
        textContent,
        contentHash: "",
        language: "en",
        publishedAt: null,
        modifiedAt: null,
        links: [],
        fetchedAt,
        depth: 0,
        truncated: false,
    };
}
