import { chunkText, type ChunkerConfig } from "../processor/chunker.js";
import type { ChunkVector, VectorRepository } from "../storage/vector-repository.ts";
import type { IndexDocument } from "../types.js";
import { EmbeddingError, type EmbeddingClient } from "./embedding-client.ts";

export interface SemanticIndexerConfig {
  chunking: ChunkerConfig;
  /** Chunks per request to the embedding service: the unit of backpressure. */
  batchSize: number;
}

export class SemanticIndexer {
    constructor(
        private readonly client: EmbeddingClient,
        private readonly vectors: VectorRepository,
        private readonly cfg: SemanticIndexerConfig,
    ) {}

    /** Chunk -> embed in batches -> persist. Idempotent per (document, version). */
    async index(doc: IndexDocument, signal?: AbortSignal): Promise<{ chunks: number }> {
        const model = await this.client.getModelInfo();
        await this.vectors.ensureModel(model);

        const chunks = chunkText(doc.content, this.cfg.chunking);
        const records: ChunkVector[] = [];
        for (let i = 0; i < chunks.length; i += this.cfg.batchSize) {
            signal?.throwIfAborted();
            const batch = chunks.slice(i, i + this.cfg.batchSize);
            // The title gives each passage its topic; the stored chunk text stays clean for snippets.
            const vectors = await this.client.embedDocuments(batch.map((c) => `${doc.title}\n${c.content}`), { signal });
            if (vectors.length !== batch.length) throw new EmbeddingError(`expected ${batch.length} vectors, got ${vectors.length}`, true);
            batch.forEach((c, j) => {
                const vector = vectors[j];
                if (vector?.length !== model.dimensions) throw new EmbeddingError(`vector has ${vector?.length} dimensions, model reports ${model.dimensions}`, false);
                records.push({ id: `${doc.id}:${doc.version}:${c.index}`, documentId: doc.id, version: doc.version, index: c.index, content: c.content, vector });
            });
        }

        await this.vectors.putVersion(doc.id, doc.version, records);
        return { chunks: records.length };
    }
}
