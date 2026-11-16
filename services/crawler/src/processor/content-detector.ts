import type { ContentKind } from "../types.ts";

/** Header only. "unknown" = missing/generic type: the body must be sniffed. */
export function detectContentKind(contentType: string | null, body?: Uint8Array): ContentKind | "unknown" {
  const type = contentType?.split(";")[0]?.trim().toLowerCase();
    switch (type) {
        case "text/html":
        case "application/xhtml+xml":
            return "html";
        case "application/xml":
        case "text/xml":
            return "xml";
        case "application/pdf":
            return "pdf";
        case "application/json":
            return "json";
        case undefined:
        case "":
        case "application/octet-stream":
            return body ? sniffKind(body) : "unknown";
        default:
            if (type.endsWith("+xml")) return "xml";
            return type.startsWith("image/") ? "image" : "other";
    }
}

/** Magic-byte fallback for servers that omit or botch Content-Type. */
export function sniffKind(body: Uint8Array): ContentKind {
    const head = new TextDecoder("latin1").decode(body.subarray(0, 512)).replace(/^\uFEFF/, "").trimStart().toLowerCase();

    if (head.startsWith("%pdf-")) 
        return "pdf";

    if (head.startsWith("<!doctype html") || head.startsWith("<html")) 
        return "html";

    if (head.startsWith("<?xml"))
        return "xml";

    return "other";
}

export type ContentVerdict = { ok: true; kind: ContentKind } | { ok: false; reason: string };

export function validateContent(contentType: string | null, body: Uint8Array, supported: ReadonlySet<ContentKind>): ContentVerdict {
    const kind = detectContentKind(contentType, body);
    if (kind === "unknown" || !supported.has(kind)) {
        return { ok: false, reason: `unsupported content type: ${contentType ?? "none"}` };
    }
    if (body.byteLength === 0) return { ok: false, reason: "empty body" };
    return { ok: true, kind };
}