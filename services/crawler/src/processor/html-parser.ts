import * as cheerio from "cheerio";
import type { DocumentProcessor, ProcessedPage, ProcessInput } from "../types.js";
import { extractDocument } from "./extract-document.ts";
import { extractLinks } from "./extract-links.ts";

export interface HtmlProcessorConfig {
    maxLinksPerPage: number;
    maxTextChars: number;
    respectMetaRobots: boolean;
    respectNofollow: boolean;
}

/** Parses once, then derives two independent outputs: links for the frontier, a document for the index. */
export class HtmlProcessor implements DocumentProcessor {
    constructor(private readonly cfg: HtmlProcessorConfig) {}

    process(input: ProcessInput): ProcessedPage {
        const $ = cheerio.load(input.html);
        const { noindex, nofollow } = this.cfg.respectMetaRobots ? readRobotsMeta($) : { noindex: false, nofollow: false };

        const links = nofollow ? [] : extractLinks($, input.url, { maxLinks: this.cfg.maxLinksPerPage, respectNofollow: this.cfg.respectNofollow });
        const document = noindex
            ? null
            : extractDocument($, {
                    url: input.url,
                    fetchedAt: input.fetchedAt,
                    depth: input.depth,
                    truncated: input.truncated,
                    links,
                    maxTextChars: this.cfg.maxTextChars,
                });
                
        return { document, links, noindex, nofollow };
    }
}

function readRobotsMeta($: cheerio.CheerioAPI): { noindex: boolean; nofollow: boolean } {
    const tokens = new Set<string>();
    $("meta[name]").each((_, el) => {
        if (($(el).attr("name") ?? "").toLowerCase() !== "robots") return;
        for (const t of ($(el).attr("content") ?? "").toLowerCase().split(",")) tokens.add(t.trim());
    });

    const none = tokens.has("none");
    return { noindex: none || tokens.has("noindex"), nofollow: none || tokens.has("nofollow") };
}