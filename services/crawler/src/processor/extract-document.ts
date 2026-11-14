import { createHash } from "node:crypto";
import type { CheerioAPI } from "cheerio";
import type { CrawledDocument } from "@search/types";
import { normalizeUrl } from "@search/utils";

export interface ExtractContext {
    url: string;
    fetchedAt: number;
    depth: number;
    truncated: boolean;
    links: string[];
    maxTextChars: number;
}

const BOILERPLATE = "script,style,noscript,template,svg,canvas,iframe,object,embed,head,nav,footer,header,aside,form,[hidden],[aria-hidden='true']";
const BLOCKS = "p,div,section,article,li,ul,ol,tr,table,pre,blockquote,dd,dt,h1,h2,h3,h4,h5,h6";
const MAX_HEADINGS = 50;

/**
 * Builds the searchable representation. NOTE: text extraction removes boilerplate from `$`,
 * so run link extraction (which wants nav links) BEFORE calling this.
 */
export function extractDocument($: CheerioAPI, ctx: ExtractContext): CrawledDocument {
    const meta = (selector: string) => $(selector).first().attr("content")?.trim() || null;

    const title = collapse($("title").first().text()) || meta('meta[property="og:title"]') || collapse($("h1").first().text()) || null;
    const description = meta('meta[name="description"]') ?? meta('meta[property="og:description"]');
    const canonicalHref = $('link[rel="canonical"]').first().attr("href");
    const declaredCanonicalUrl = (canonicalHref && normalizeUrl(canonicalHref, ctx.url)) || undefined;
    const language = $("html").attr("lang")?.trim().toLowerCase() || meta('meta[http-equiv="content-language"]')?.toLowerCase() || null;

    const headings: string[] = [];
    $("h1,h2,h3,h4,h5,h6").each((_, el) => {
        const text = collapse($(el).text());
        if (text && headings.length < MAX_HEADINGS) headings.push(text);
    });

    const publishedAt = parseDate(meta('meta[property="article:published_time"]') ?? meta('meta[itemprop="datePublished"]') ?? meta('meta[name="date"]'));
    const modifiedAt = parseDate(meta('meta[property="article:modified_time"]') ?? meta('meta[itemprop="dateModified"]') ?? meta('meta[property="og:updated_time"]'));

    const textContent = extractText($).slice(0, ctx.maxTextChars);

    return {
        url: ctx.url,
        declaredCanonicalUrl,
        title,
        description,
        headings,
        textContent,
        contentHash: createHash("sha256").update(textContent).digest("hex"),
        language,
        publishedAt,
        modifiedAt,
        links: ctx.links,
        fetchedAt: ctx.fetchedAt,
        depth: ctx.depth,
        truncated: ctx.truncated,
    };
}

/** Heuristic main-content extraction: drop boilerplate, prefer <main>/<article>, keep block breaks. */
function extractText($: CheerioAPI): string {
    $(BOILERPLATE).remove();
    const candidate = $("main,[role='main'],article").first();
    const body = $("body").first();
    const container = candidate.length && candidate.text().length >= 200 ? candidate : body; // cheerio.load() always synthesizes <body>
    container.find("br").replaceWith("\n");
    container.find(BLOCKS).after("\n");
    return normalizeText(container.text());
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

function normalizeText(s: string): string {
    return s
        .replace(/\r/g, "")
        .replace(/[ \t\f\v\u00a0]+/g, " ")
        .split("\n")
        .map((line) => line.trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function parseDate(value: string | null): number | null {
    if (!value) return null;
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
}