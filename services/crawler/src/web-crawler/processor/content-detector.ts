export type ContentKind =
    | "html"
    | "pdf"
    | "json"
    | "image"
    | "other";

export function detectContentType(
    contentType: string | null
): ContentKind {
    const type = contentType
        ?.split(";")[0]
        ?.trim()
        .toLowerCase();

    switch (type) {
        case "text/html":
        case "application/xhtml+xml":
            return "html";

        case "application/pdf":
            return "pdf";

        case "application/json":
            return "json";

        default:
            return type?.startsWith("image/")
                ? "image"
                : "other";
    }
}