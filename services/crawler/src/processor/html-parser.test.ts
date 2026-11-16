import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HtmlProcessor } from "./html-parser.ts";

describe("HtmlProcessor", () => {
    it("decodes and processes HTML while extracting text and links", () => {
        const processor = new HtmlProcessor({
            maxLinksPerPage: 10,
            maxTextChars: 1000,
            respectMetaRobots: true,
            respectNofollow: false,
        });
        const page = processor.process({
            url: "https://example.com/article",
            kind: "html",
            contentType: "text/html; charset=utf-8",
            body: new TextEncoder().encode(
                "<html><head><title>Article</title></head><body><main><p>Useful content.</p></main><a href='/next'>Next</a></body></html>",
            ),
            fetchedAt: 123,
            depth: 1,
            truncated: false,
        });

        assert.equal(page.document?.title, "Article");
        assert.match(page.document?.textContent ?? "", /Useful content/);
        assert.deepEqual(page.links, ["https://example.com/next"]);
    });
});
