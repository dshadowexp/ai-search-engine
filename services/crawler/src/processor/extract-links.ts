import type { CheerioAPI } from "cheerio";

export interface LinkExtractorOptions {
    maxLinks: number;
    respectNofollow: boolean;
}

/**
 * Candidate URLs only: resolve (honouring <base href>), keep http(s), drop fragments, dedupe, cap.
 * The frontier stays the authority on normalization, scope, SSRF and deduplication.
 */
export function extractLinks($: CheerioAPI, pageUrl: string, opts: LinkExtractorOptions): string[] {
    let base = pageUrl;
    const baseHref = $("base[href]").first().attr("href");
    if (baseHref) {
        try {
            base = new URL(baseHref, pageUrl).href;
        } catch {
            /* ignore a malformed <base> */
        }
    }

    const links = new Set<string>();
    $("a[href]").each((_, el) => {
        if (links.size >= opts.maxLinks) 
            return false; // stop iterating

        const a = $(el);
        if (opts.respectNofollow && /\bnofollow\b/i.test(a.attr("rel") ?? "")) 
            return;
        
        const href = a.attr("href")?.trim();
        if (!href) 
            return;

        try {
            const url = new URL(href, base);
            if (url.protocol !== "http:" && url.protocol !== "https:") 
                return;

            url.hash = "";
            links.add(url.href);
        } catch {
            /* malformed URL */
        }
    });
    return [...links];
}
