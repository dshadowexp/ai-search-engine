import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ImageProcessor } from "./image-parser.ts";

describe("ImageProcessor", () => {
    it("creates an indexable metadata document without treating image bytes as text", () => {
        const body = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        const page = new ImageProcessor().process({
            url: "https://example.com/images/forest%20trail.png",
            kind: "image",
            contentType: "image/png",
            body,
            fetchedAt: 123,
            depth: 1,
            truncated: false,
        });

        assert.equal(page.document?.title, "forest trail");
        assert.match(page.document?.textContent ?? "", /image\/png/);
        assert.match(page.document?.textContent ?? "", /4 bytes/);
        assert.deepEqual(page.links, []);
    });
});
