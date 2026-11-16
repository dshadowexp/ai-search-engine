import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { CrawledDocument } from "@search/core";
import type { DocumentProcessor, ProcessedPage, ProcessInput } from "../types.ts";
import { decodeBody } from "./decode-body.ts";

export interface XmlProcessorConfig {
    maxLinksPerPage: number;
    maxTextChars: number;
}

export class XmlProcessor implements DocumentProcessor {
    private readonly cfg: XmlProcessorConfig;

    constructor(cfg: XmlProcessorConfig) {
        this.cfg = cfg;
    }

    process(input: ProcessInput): ProcessedPage {
        const $ = cheerio.load(decodeBody(input.body, input.contentType), { xml: { xmlMode: true } });
        const textContent = normalizeText($.root().text()).slice(0, this.cfg.maxTextChars);
        const links = extractXmlLinks($, input.url, this.cfg.maxLinksPerPage);
        const root = $.root().children().first();
        const title = normalizeText($("channel > title, feed > title, title").first().text()) || null;
        const description = normalizeText($("channel > description, feed > subtitle, description, summary").first().text()) || null;
        const language = root.attr("xml:lang")?.trim().toLowerCase() || null;
        const document: CrawledDocument = {
            url: input.url,
            title,
            description,
            headings: [],
            textContent,
            contentHash: createHash("sha256").update(textContent).digest("hex"),
            language,
            publishedAt: null,
            modifiedAt: null,
            links,
            fetchedAt: input.fetchedAt,
            depth: input.depth,
            truncated: input.truncated,
        };

        return { document, links, noindex: false, nofollow: false };
    }
}

function extractXmlLinks($: cheerio.CheerioAPI, baseUrl: string, maxLinks: number): string[] {
    const links = new Set<string>();
    $("a[href], link, loc").each((_, element) => {
        if (links.size >= maxLinks) return false;

        const node = $(element);
        const candidate = node.attr("href")?.trim() || node.text().trim();
        if (!candidate) return;

        try {
            const url = new URL(candidate, baseUrl);
            if (url.protocol !== "http:" && url.protocol !== "https:") return;
            url.hash = "";
            links.add(url.href);
        } catch {
            // Ignore non-URL XML values.
        }
    });
    return [...links];
}

function normalizeText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}
