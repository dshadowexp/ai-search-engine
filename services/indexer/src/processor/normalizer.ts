// Control chars (except \t \n \r), DEL/C1, zero-width space, BOM, soft hyphen.
const NOISE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b\ufeff\u00ad]/g;

/** Canonical text form: NFC, no control noise, single spaces, trimmed lines, at most one blank line in a row. */
export function normalizeText(text: string): string {
    return text
        .normalize("NFC")
        .replace(NOISE, "")
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t\f\v\u00a0]+/g, " ")
        .split("\n")
        .map((line) => line.trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/** "en-US" -> "en"; anything unrecognisable -> "und" (undetermined). */
export function normalizeLanguage(lang: string | null | undefined): string {
    const primary = lang?.trim().toLowerCase().split(/[-_]/)[0] ?? "";
    return /^[a-z]{2,3}$/.test(primary) ? primary : "und";
}