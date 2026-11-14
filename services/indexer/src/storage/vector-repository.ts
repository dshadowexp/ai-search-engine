import { PriorityQueue } from "@search/shared";
import { EmbeddingError, modelId, type EmbeddingModelInfo } from "../semantic/embedding-client.ts";

export interface ChunkVector {
    id: string; // `${documentId}:${version}:${index}`: deterministic, so re-embedding is idempotent
    documentId: string;
    version: number;
    index: number;
    content: string;
    vector: Float32Array;
}

export interface ScoredChunk {
    chunk: Omit<ChunkVector, "vector">;
    similarity: number; // cosine
}

/** Same version rules as the lexical repository: write per version, only the ACTIVE version is searchable. */
export interface VectorRepository {
    /** Pins the index to one embedding model. Throws a non-retryable EmbeddingError if it conflicts with stored vectors. */
    ensureModel(model: EmbeddingModelInfo): Promise<void>;
    putVersion(documentId: string, version: number, chunks: ChunkVector[]): Promise<void>;
    activate(documentId: string, version: number): Promise<boolean>;
    removeVersionsBefore(documentId: string, version: number): Promise<void>;
    search(query: Float32Array, limit: number): Promise<ScoredChunk[]>;
}

const normalize = (v: Float32Array): Float32Array => {
    let sum = 0;
    for (const x of v) sum += x * x;
    const norm = Math.sqrt(sum) || 1;
    return v.map((x) => x / norm);
};

/** Exact (brute-force) cosine search. Fine for small corpora; pgvector's HNSW replaces it at scale. */
export class InMemoryVectorRepository implements VectorRepository {
    private model?: EmbeddingModelInfo;
    private readonly store = new Map<string, Map<number, ChunkVector[]>>();
    private readonly active = new Map<string, number>();

    async ensureModel(model: EmbeddingModelInfo): Promise<void> {
        if (this.model && modelId(this.model) !== modelId(model)) {
        if (this.store.size > 0) {
            throw new EmbeddingError(`vector index holds ${modelId(this.model)} but the service now reports ${modelId(model)}: re-embed all documents`, false);
        }
        }
        this.model = model;
    }

    async putVersion(documentId: string, version: number, chunks: ChunkVector[]): Promise<void> {
        const versions = this.store.get(documentId) ?? new Map<number, ChunkVector[]>();
        versions.set(version, chunks.map((c) => ({ ...c, vector: normalize(c.vector) })));
        this.store.set(documentId, versions);
    }

    async activate(documentId: string, version: number): Promise<boolean> {
        if (!this.store.get(documentId)?.has(version)) return false;
        this.active.set(documentId, version);
        return true;
    }

    async removeVersionsBefore(documentId: string, version: number): Promise<void> {
        const versions = this.store.get(documentId);
        if (!versions) return;
        for (const v of [...versions.keys()]) {
        if (v >= version) continue;
        versions.delete(v);
        if (this.active.get(documentId) === v) this.active.delete(documentId);
        }
    }

    async search(query: Float32Array, limit: number): Promise<ScoredChunk[]> {
        const q = normalize(query);
        const top = new PriorityQueue<ScoredChunk>((a, b) => a.similarity < b.similarity); // min-heap of the best `limit`

        for (const [documentId, version] of this.active) {
            for (const { vector, ...chunk } of this.store.get(documentId)?.get(version) ?? []) {
                if (vector.length !== q.length) throw new EmbeddingError(`query has ${q.length} dimensions, index has ${vector.length}`, false);
                let dot = 0;
                for (let i = 0; i < q.length; i++) 
                    dot += q[i] * vector[i];

                top.push({ chunk, similarity: dot });
                if (top.size > limit) top.pop();
            }
        }

        const out: ScoredChunk[] = [];
        for (let s = top.pop(); s; s = top.pop()) out.push(s);
        return out.reverse();
    }
}