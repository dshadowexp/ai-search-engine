import { TRACKING_PARAMS } from "./constants.js";

export function normalizeUrl(input: string, baseUrl?: string): string {
    // 1. Parse and resolve relative URLs
    const url = baseUrl
        ? new URL(input, baseUrl)
        : new URL(input);

    // 2. Normalize scheme
    url.protocol = url.protocol.toLowerCase();

    // 3. Normalize hostname
    url.hostname = url.hostname.toLowerCase(); //standardized approach to normalize

    // 4. Remove default ports
    if (
        (url.protocol === "http:" && url.port === "80") ||
        (url.protocol === "https:" && url.port === "443")
    ) {
        url.port = "";
    }

    // 5. Remove fragment
    url.hash = "";

    // 6. Normalize query parameters
    // Remove only explicitly known tracking parameters.
    for (const key of [...url.searchParams.keys()]) {
        if (TRACKING_PARAMS.has(key.toLowerCase())) {
            url.searchParams.delete(key);
        }
    }

    // 7. Normalize trailing dot on hostname
    if (url.hostname.endsWith(".")) {
        url.hostname = url.hostname.slice(0, -1);
    }

    // 8. Normalize trailing slash on pathname
    if (url.pathname.length > 0 && url.pathname.endsWith("/")) {
        url.pathname = url.pathname.slice(0, -1);
    }

    const normalizedPathname = url.pathname.replace(/\/{2,}/g, "/");
    url.pathname = normalizedPathname;

    // 9. Return WHATWG URL's canonical serialization
    return url.href;
}