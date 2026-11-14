export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .normalize("NFKC")
        .match(/[\p{L}\p{N}]+/gu) ?? [];
}