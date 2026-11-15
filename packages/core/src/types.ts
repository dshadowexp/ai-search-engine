export interface CrawledDocument {
    url: string; // the frontier's canonical URL: the document's identity
    declaredCanonicalUrl?: string | undefined; // <link rel="canonical">, normalized
    title: string | null;
    description: string | null;
    headings: string[];
    textContent: string;
    contentHash: string; // sha256 of textContent
    language: string | null;
    publishedAt: number | null;
    modifiedAt: number | null;
    links: string[];
    fetchedAt: number;
    depth: number;
    truncated: boolean;
}