import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { DomHandler } from "domhandler";
import { Parser } from "htmlparser2";
import robotsParser, { type Robot } from "robots-parser";
import puppeteer, { type Browser } from "puppeteer";
import { FETCH_TIMEOUT_MS, MAX_CONTENT_BYTES, PUPPETEER_TIMEOUT_MS, USER_AGENT } from "./constants.js";

// Everything about actually retrieving one page: robots.txt rules,
// the streaming HTTP fetch, and the headless-browser fallback.
// Knows nothing about queues, scheduling, or which URL comes next.
class Fetcher {
    // null cached = no robots.txt found for that origin, treat as allow-all
    private robotsCache = new Map<string, Robot | null>();

    // Launched lazily, on first actual need.
    private browser: Browser | null = null;

    // --- robots.txt ---

    

    async isAllowed(url: string): Promise<boolean> {
        // const origin = new URL(url).origin;
        // const rules = await this.getRobotsRules(origin);
        // if (!rules) return true;
        // return rules.isAllowed(url, USER_AGENT) ?? true;
        return true;
    }

    // Site-specified crawl delay, if robots.txt declares one for our agent.
    // Frontier uses this to override its default per-domain delay.
    async getCrawlDelayMs(url: string): Promise<number | null> {
        // const origin = new URL(url).origin;
        // const rules = await this.getRobotsRules(origin);
        // const seconds = rules?.getCrawlDelay(USER_AGENT);
        // return seconds ? seconds * 1000 : null;
        return null;
    }

    // --- streaming fetch + parse ---

    // Streams the response body into htmlparser2 as bytes arrive, building
    // the DOM incrementally, then hands the finished DOM to cheerio (which
    // accepts a pre-built DOM, avoiding parsing twice). The real payoff for
    // a crawler: bytes are inspected as they arrive so an oversized response
    // can be aborted mid-download instead of buffered in full first.
    private async fetchAndParse(url: string): Promise<cheerio.CheerioAPI> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        let res: Response;
        try {
            res = await fetch(url, {
                headers: { "User-Agent": USER_AGENT },
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeout);
        }

        if (!res.ok || !res.body) {
            throw new Error(`Fetch failed with status ${res.status}`);
        }

        return new Promise((resolve, reject) => {
            const handler = new DomHandler((err, dom) => {
                if (err) reject(err);
                else resolve(cheerio.load(dom as AnyNode[]));
            });
            const parser = new Parser(handler);
            const decoder = new TextDecoder();
            const reader = res.body!.getReader();

            let bytesRead = 0;

            const pump = (): void => {
                reader.read().then(({ done, value }) => {
                    if (done) {
                        parser.end();
                        return;
                    }

                    bytesRead += value.byteLength;
                    if (bytesRead > MAX_CONTENT_BYTES) {
                        controller.abort();
                        reader.cancel().catch(() => {});
                        reject(new Error(`Page exceeded ${MAX_CONTENT_BYTES} byte limit`));
                        return;
                    }

                    parser.write(decoder.decode(value, { stream: true }));
                    pump();
                }, reject);
            };

            pump();
        });
    }

    // --- headless browser fallback ---

    private async getBrowser(): Promise<Browser> {
        if (!this.browser) {
            this.browser = await puppeteer.launch({ headless: true });
        }
        return this.browser;
    }

    private async fetchWithPuppeteer(url: string): Promise<cheerio.CheerioAPI> {
        const browser = await this.getBrowser();
        const page = await browser.newPage();
        try {
            await page.setUserAgent(USER_AGENT);
            await page.goto(url, {
                waitUntil: "networkidle2",
                timeout: PUPPETEER_TIMEOUT_MS,
            });
            const html = await page.content();
            return cheerio.load(html);
        } finally {
            await page.close();
        }
    }

    // Crude heuristic: near-empty text content after parsing suggests a
    // client-rendered shell (React/Vue) rather than server-rendered HTML.
    private looksClientRendered($: cheerio.CheerioAPI): boolean {
        return $("body").text().trim().length < 200;
    }

    // --- public entry point ---

    // Note: does NOT check robots.txt itself — call isAllowed() first.
    // Keeping that check separate lets the caller (Crawler) decide what
    // to do with a disallowed URL without Fetcher silently swallowing it.
    async fetch(url: string): Promise<cheerio.CheerioAPI> {
        try {
            const $ = await this.fetchAndParse(url);
            if (this.looksClientRendered($)) {
                return await this.fetchWithPuppeteer(url);
            }
            return $;
        } catch {
            return await this.fetchWithPuppeteer(url);
        }
    }

    async close(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

export default Fetcher;