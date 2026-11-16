import { isIP } from "node:net";

export function isPublicHostname(hostname: string): boolean {
    const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (isIP(h)) return isPublicIp(h);
    if (h === "localhost" || !h.includes(".")) return false;
    const internalSuffixes = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa"];
    return !internalSuffixes.some((s) => h.endsWith(s));
}

export function isPublicIp(ip: string): boolean {
    const kind = isIP(ip);
    if (kind === 4) return isPublicIPv4(ip);
    if (kind === 6) return isPublicIPv6(ip);
    return false;
}

function isPublicIPv4(ip: string): boolean {
    const [a, b, c] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b! >= 64 && b! <= 127) return false; // CGNAT
    if (a === 169 && b === 254) return false; // link-local / cloud metadata
    if (a === 172 && b! >= 16 && b! <= 31) return false;
    if (a === 192 && b === 0 && c === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a! >= 224) return false; // multicast + reserved
    return true;
}

function isPublicIPv6(ip: string): boolean {
    const l = ip.toLowerCase();
    if (l === "::" || l === "::1") return false;
    if (l.startsWith("::ffff:")) return false; // IPv4-mapped: could hide a private v4
    if (l.startsWith("64:ff9b:")) return false; // NAT64
    if (l.startsWith("2001:db8")) return false; // documentation
    const first = parseInt(l.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
    if ((first & 0xffc0) === 0xfe80) return false; // link-local
    if ((first & 0xff00) === 0xff00) return false; // multicast
    return true;
}