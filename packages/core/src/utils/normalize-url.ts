export interface NormalizeOptions {
    stripTrackingParams?: boolean;
    trackingParams?: string[];
    sortQueryParams?: boolean;
    stripTrailingSlash?: boolean;
    allowedProtocols?: string[];
}

const DEFAULT_TRACKING = ["gclid", "fbclid", "msclkid", "mc_cid", "mc_eid", "igshid"];

export function normalizeUrl(raw: string, base?: string, opts: NormalizeOptions = {}): string | null {
    let u: URL;
    try {
        u = new URL(raw.trim(), base);
    } catch {
        return null;
    }
    const protocols = opts.allowedProtocols ?? ["http:", "https:"];
    if (!protocols.includes(u.protocol)) return null;
    if (u.username || u.password) return null;
    if (!u.hostname) return null;

    u.hash = "";
    if (u.hostname.endsWith(".")) u.hostname = u.hostname.slice(0, -1);

    if (opts.stripTrackingParams) {
        const names = new Set((opts.trackingParams ?? DEFAULT_TRACKING).map((n) => n.toLowerCase()));
        for (const key of [...u.searchParams.keys()]) {
        const k = key.toLowerCase();
        if (names.has(k) || k.startsWith("utm_")) u.searchParams.delete(key);
        }
    }
    if (opts.sortQueryParams) u.searchParams.sort();
    if (opts.stripTrailingSlash && u.pathname.length > 1 && u.pathname.endsWith("/")) {
        u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    }
    return u.href;
}