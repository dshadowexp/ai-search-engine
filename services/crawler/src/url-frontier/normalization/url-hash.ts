import { createHash } from "node:crypto";

/**
 * 
 * @param canonicalUrl 
 * @returns 
 */
export function hashUrl(canonicalUrl: string): string {
    return createHash("sha256").update(canonicalUrl).digest("hex");
}