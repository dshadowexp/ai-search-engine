import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DocumentProcessor, ProcessInput, ProcessedPage } from "../types.ts";
import { ProcessorRouter } from "./processor-router.ts";

const page: ProcessedPage = { document: null, links: [], noindex: false, nofollow: false };
const input: ProcessInput = {
    url: "https://example.com/feed.xml",
    kind: "xml",
    contentType: "application/xml",
    body: new Uint8Array(),
    fetchedAt: 1,
    depth: 0,
    truncated: false,
};

describe("ProcessorRouter", () => {
    it("dispatches to the processor registered for the detected kind", () => {
        let received: ProcessInput | undefined;
        const xmlProcessor: DocumentProcessor = {
            process(value) {
                received = value;
                return page;
            },
        };
        const router = new ProcessorRouter({ xml: xmlProcessor });

        assert.equal(router.process(input), page);
        assert.equal(received, input);
    });

    it("fails setup when an enabled kind has no processor", () => {
        const router = new ProcessorRouter({});
        assert.throws(() => router.assertSupports(["xml"]), /No processor registered.*xml/);
    });
});
