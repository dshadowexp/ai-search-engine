import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectContentKind } from "./content-detector.ts";

describe("detectContentKind", () => {
    it("recognizes XML media types, including structured suffixes", () => {
        assert.equal(detectContentKind("application/xml"), "xml");
        assert.equal(detectContentKind("text/xml; charset=utf-8"), "xml");
        assert.equal(detectContentKind("application/atom+xml"), "xml");
        assert.equal(detectContentKind("application/xhtml+xml"), "html");
    });

    it("sniffs XML declarations when the server omits a useful content type", () => {
        const body = new TextEncoder().encode('<?xml version="1.0"?><feed/>');
        assert.equal(detectContentKind("application/octet-stream", body), "xml");
    });
});