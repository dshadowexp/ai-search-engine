import { it, describe } from 'node:test';
import assert from 'node:assert';
import { normalizeUrl } from './normalize-url.ts';
import { isPublicHostname } from './ssrf-guard.ts';

describe("normalization", () => {
    it("collapses equivalent URLs", () => {
        const variants = ["https://example.com/about", "https://example.com/about#team", "https://EXAMPLE.com/about", "https://example.com:443/about", "https://example.com./about"];
        assert.equal(new Set(variants.map((v) => normalizeUrl(v))).size, 1);
    });
    it("resolves relative URLs and keeps query strings by default", () => {
        assert.equal(normalizeUrl("../x?b=2&a=1", "https://e.com/a/b/c"), "https://e.com/a/x?b=2&a=1");
        assert.notEqual(normalizeUrl("https://e.com/p?id=1"), normalizeUrl("https://e.com/p?id=2"));
    });
    it("only changes query/trailing slash when configured", () => {
        assert.equal(normalizeUrl("https://e.com/a/?b=2&a=1&utm_source=x", undefined, { sortQueryParams: true, stripTrackingParams: true, stripTrailingSlash: true }), "https://e.com/a?a=1&b=2");
    });
    it("rejects bad protocols, garbage and credentials", () => {
        for (const bad of ["ftp://e.com/", "javascript:alert(1)", "not a url", "https://user:pw@e.com/"]) assert.equal(normalizeUrl(bad), null);
    });
    it("blocks non-public hosts", () => {
        for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.1", "169.254.169.254", "[::1]", "[::ffff:7f00:1]", "[fd00::1]", "intranet", "db.internal"]) assert.equal(isPublicHostname(h), false, h);
        for (const h of ["example.com", "8.8.8.8", "[2606:4700::1111]"]) assert.equal(isPublicHostname(h), true, h);
    });
});