import { it, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { normalizeUrl } from './normalize-url.ts';
import { isPublicHostname } from '../../utils/ssrf-guard.ts';

describe('normalizeUrl', () => {
    let url: string;

    beforeEach(() => {
        url = "https://example.com";
    });

    it("normalizes the scheme to lowercase", () => {
        assert.equal(
            normalizeUrl("HTTPS://example.com"),
            "https://example.com/",
        );
    });

    it("hostname normalization", () => {
        assert.equal(
            normalizeUrl("https://EXAMPLE.com."),
            "https://example.com/",
        );
    });

    describe("default port normalization", () => {
        it("removes the default HTTP port", () => {
            assert.equal(
                normalizeUrl("http://example.com:80"),
                "http://example.com/",
            );
        });

        it("removes the default HTTPS port", () => {
            assert.equal(
                normalizeUrl("https://example.com:443"),
                "https://example.com/",
            );
        });

        it("preserves non-default HTTP ports", () => {
            assert.equal(
                normalizeUrl("http://example.com:8080"),
                "http://example.com:8080/",
            );
        });
    });

    describe("fragment normalization", () => {
        it("removes URL fragments", () => {
            assert.equal(
                normalizeUrl("https://example.com/page#section"),
                "https://example.com/page",
            );
        });

        it("removes fragments while preserving the query string", () => {
            assert.equal(
                normalizeUrl("https://example.com/page?id=123#section"),
                "https://example.com/page?id=123",
            );
        });

        it("treats URLs differing only by fragments as equivalent", () => {
            assert.equal(
                normalizeUrl("https://example.com/page#one"),
                normalizeUrl("https://example.com/page#two"),
            );
        });
    });

    describe("path normalization", () => {
        it("normalizes dot segments", () => {
            assert.equal(
                normalizeUrl("https://example.com/a/../b"),
                "https://example.com/b",
            );
        });

        it("normalizes current-directory segments", () => {
            assert.equal(
                normalizeUrl("https://example.com/a/./b"),
                "https://example.com/a/b",
            );
        });

        it("preserves path case", () => {
            assert.notEqual(
                normalizeUrl("https://example.com/Products"),
                normalizeUrl("https://example.com/products"),
            );
        });

        it("collapse repeated slashes", () => {
            assert.notEqual(
                normalizeUrl("https://example.com/a//b"),
                normalizeUrl("https://example.com/a/b"),
            );
        });
    });

    describe("tracking parameters", () => {
        it("removes known tracking parameters", () => {
            assert.equal(
                normalizeUrl("https://example.com/page?utm_source=google"),
                "https://example.com/page",
            );
        });

        it("removes multiple tracking parameters", () => {
            assert.equal(
                normalizeUrl("https://example.com/page?utm_source=google&utm_medium=cpc&gclid=123"),
                "https://example.com/page",
            );
        });

        it("preserves non-tracking parameters", () => {
            assert.equal(
                normalizeUrl("https://example.com/page?id=123&utm_source=google"),
                "https://example.com/page?id=123",
            );
        });

        it("removes tracking parameters regardless of parameter-name case", () => {
            assert.equal(
                normalizeUrl("https://example.com/page?UTM_SOURCE=google"),
                "https://example.com/page",
            );
        });

        it("preserves duplicate non-tracking parameters", () => {
            assert.equal(
                normalizeUrl("https://example.com/page?id=1&id=2"),
                "https://example.com/page?id=1&id=2",
            );
        });

        it("preserves query parameters", () => {
            assert.equal(
                normalizeUrl("https://example.com/search?q=nodejs"),
                "https://example.com/search?q=nodejs",
            );
        });

        it("preserves query parameter ordering", () => {
            assert.notEqual(
                normalizeUrl("https://example.com/page?a=1&b=2"),
                normalizeUrl("https://example.com/page?b=2&a=1"),
            );
        });

        it("does not remove arbitrary query parameters", () => {
            assert.equal(
                normalizeUrl("https://example.com/page?session=123"),
                "https://example.com/page?session=123",
            );
        });
    });

    describe("relative URLs", () => {
        const baseUrl = "https://example.com/docs/page";

        it("resolves relative paths", () => {
            assert.equal(
                normalizeUrl("/about", baseUrl),
                "https://example.com/about",
            );
        });

        it("resolves relative files", () => {
            assert.equal(
                normalizeUrl("../about", baseUrl),
                "https://example.com/about",
            );
        });

        it("resolves relative URLs against the base URL", () => {
            assert.equal(
                normalizeUrl("team", baseUrl),
                "https://example.com/docs/team",
            );
        });

        it("resolves protocol-relative URLs", () => {
            assert.equal(
                normalizeUrl("//cdn.example.com/image.png", baseUrl),
                "https://cdn.example.com/image.png",
            );
        });
    });

    describe("combined normalization", () => {
        it("applies multiple normalization rules together", () => {
            assert.equal(
                normalizeUrl("HTTPS://EXAMPLE.COM:443/a/../products/?utm_source=google#reviews"),
                "https://example.com/products/",
            );
        });

        it("produces the same canonical URL for equivalent representations", () => {
            const url1 = normalizeUrl("HTTPS://EXAMPLE.COM:443/products/?utm_source=google#reviews");
            const url2 = normalizeUrl("https://example.com/products/");
            assert.equal(url1, url2);
        });
    });

    describe("invalid URLs", () => {
        it("throws for an invalid absolute URL", () => {
            assert.throws(() => {
                normalizeUrl("not-a-url");
            });
        });

        it("throws for an invalid URL with an invalid base", () => {
            assert.throws(() => {
                normalizeUrl("/about", "not-a-url");
            });
        });
    });
});

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