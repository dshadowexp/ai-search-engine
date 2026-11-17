/** A short window of `text` around the first query term found, whitespace-collapsed. */
export function makeSnippet(text: string, terms: readonly string[], maxLength = 200): string {
    const flat = text.replace(/\s+/g, " ").trim();
    const lower = flat.toLowerCase();
    let at = -1;
    for (const t of terms) {
        const i = lower.indexOf(t);
        if (i >= 0 && (at < 0 || i < at)) at = i;
    }
    const start = at < 0 ? 0 : Math.max(0, at - Math.floor(maxLength / 3));
    const slice = flat.slice(start, start + maxLength);
    return `${start > 0 ? "…" : ""}${slice}${start + maxLength < flat.length ? "…" : ""}`;
}
