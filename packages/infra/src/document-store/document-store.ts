/**
 * Where crawled documents go. save() MUST be idempotent (keyed by document.url): a crash
 * between save() and acknowledge() means the URL is crawled again and saved again.
 */
export interface DocumentStore<T, R> {
    save(document: T): Promise<R>;
    get(url: string): Promise<T | undefined>;
}