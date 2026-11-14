import { createHash } from "node:crypto";

export function hashContent(parts: readonly string[]): string {
    const h = createHash("sha256");
    for (const p of parts) {
        h.update(p);
        h.update("\u0000");
    }
    return h.digest("hex");
}