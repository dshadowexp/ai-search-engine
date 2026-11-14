export interface EmbeddingModelInfo {
    name: string;
    version: string;
    dimensions: number;
}

/** Vectors are only comparable within one model, version and dimensionality. */
export const modelId = (m: EmbeddingModelInfo): string => `${m.name}@${m.version}/${m.dimensions}`;

/** Throw with retryable=false for problems no retry can fix (bad input, dimension mismatch, model changed). */
export class EmbeddingError extends Error {
    constructor(
        message: string,
        readonly retryable: boolean,
    ) {
        super(message);
        this.name = "EmbeddingError";
    }
}

/**
 * The seam to the ML service. Nothing in the indexer knows how embeddings are produced:
 * the Python service sits behind this interface (a gRPC client is the intended implementation).
 */
export interface EmbeddingClient {
    getModelInfo(): Promise<EmbeddingModelInfo>;
    /** Passages for indexing. Output order matches input order. Honour `signal` (deadline / shutdown). */
    embedDocuments(texts: string[], options?: { signal?: AbortSignal | undefined }): Promise<Float32Array[]>;
    /** Queries may be embedded differently from passages (instruction prefixes), so it is a separate call. */
    embedQuery(text: string, options?: { signal?: AbortSignal }): Promise<Float32Array>;
    close(): Promise<void>;
}
