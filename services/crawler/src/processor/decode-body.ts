/** Bytes -> string using the HTTP charset, else a <meta charset> sniff, else UTF-8. */
export function decodeBody(body: Uint8Array, contentType: string | null): string {
    const label = charsetFromHeader(contentType) ?? charsetFromMeta(body) ?? "utf-8";
    try {
        return new TextDecoder(label).decode(body);
    } catch {
        return new TextDecoder("utf-8").decode(body); // unknown label
    }
}

const charsetFromHeader = (ct: string | null) => ct?.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1];

function charsetFromMeta(body: Uint8Array): string | undefined {
    const head = new TextDecoder("latin1").decode(body.subarray(0, 2048));
    return head.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)?.[1];
}
