import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { XmlProcessor } from "./xml-parser.ts";

describe("XmlProcessor", () => {
    it("extracts feed text and resolves XML links", () => {
        const processor = new XmlProcessor({ maxLinksPerPage: 10, maxTextChars: 1000 });
        const page = processor.process({
            url: "https://example.com/feed.xml",
            kind: "xml",
            contentType: "application/atom+xml",
            body: new TextEncoder().encode(
                `<feed xml:lang="en">
                    <title>Example feed</title>
                    <subtitle>Feed description</subtitle>
                    <link href="/"/>
                    <entry><title>Article</title><link href="/article"/></entry>
                </feed>`,
            ),
            fetchedAt: 123,
            depth: 1,
            truncated: false,
        });

        assert.equal(page.document?.title, "Example feed");
        assert.equal(page.document?.description, "Feed description");
        assert.equal(page.document?.language, "en");
        assert.deepEqual(page.links, ["https://example.com/", "https://example.com/article"]);
        assert.equal(page.document?.links, page.links);
    });
});
