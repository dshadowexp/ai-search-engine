import { DEFAULT_BM25, type Bm25Params } from "./lexical/bm25.js";
import type { ChunkerConfig } from "./processor/chunker.js";
import type { PerField } from "./storage/lexical-repository.js";
import { INDEX_STAGES, type IndexStage } from "./types.js";

export interface IndexingConfig {
    /** Injectable clock (ms), as in the frontier and crawler. */
    now?: () => number;
    /** Workers per stage. Separate pools = separate backpressure: slow embeddings never starve lexical indexing. */
    lexicalConcurrency?: number;
    semanticConcurrency?: number;
    leaseTtlMs?: number;
    retry?: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number };
    /**
     * Stages that must finish before a new version replaces the active one. Default ["lexical"]:
     * text becomes searchable as soon as it is indexed, vectors follow when ready.
     */
    activationStages?: IndexStage[];
    maxContentChars?: number;
    bm25?: { k1?: number; b?: Partial<PerField<number>>; weights?: Partial<PerField<number>> };
    chunking?: Partial<ChunkerConfig>;
    embeddingBatchSize?: number;
    /** Drop semantic hits below this cosine similarity. */
    minSimilarity?: number;
    idlePollMs?: number;
    /** How often unpublished (completed but not yet searchable) stages are re-examined. */
    reconcileIntervalMs?: number;
}

export interface ResolvedIndexingConfig {
    now: () => number;
    lexicalConcurrency: number;
    semanticConcurrency: number;
    leaseTtlMs: number;
    retry: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number };
    activationStages: IndexStage[];
    maxContentChars: number;
    bm25: Bm25Params;
    chunking: ChunkerConfig;
    embeddingBatchSize: number;
    minSimilarity: number;
    idlePollMs: number;
    reconcileIntervalMs: number;
}

export function resolveIndexingConfig(cfg: IndexingConfig, semanticEnabled: boolean): ResolvedIndexingConfig {
    const resolved: ResolvedIndexingConfig = {
        now: cfg.now ?? Date.now,
        lexicalConcurrency: cfg.lexicalConcurrency ?? 2,
        semanticConcurrency: cfg.semanticConcurrency ?? 2,
        leaseTtlMs: cfg.leaseTtlMs ?? 60_000,
        retry: {
            maxAttempts: cfg.retry?.maxAttempts ?? 5,
            baseDelayMs: cfg.retry?.baseDelayMs ?? 1_000,
            maxDelayMs: cfg.retry?.maxDelayMs ?? 300_000,
        },
        activationStages: cfg.activationStages ?? ["lexical"],
        maxContentChars: cfg.maxContentChars ?? 1_000_000,
        bm25: {
            k1: cfg.bm25?.k1 ?? DEFAULT_BM25.k1,
            b: { ...DEFAULT_BM25.b, ...cfg.bm25?.b },
            weights: { ...DEFAULT_BM25.weights, ...cfg.bm25?.weights },
        },
        chunking: { 
            maxTokens: cfg.chunking?.maxTokens ?? 500, 
            overlapTokens: cfg.chunking?.overlapTokens ?? 60 
        },
        embeddingBatchSize: cfg.embeddingBatchSize ?? 32,
        minSimilarity: cfg.minSimilarity ?? 0,
        idlePollMs: cfg.idlePollMs ?? 250,
        reconcileIntervalMs: cfg.reconcileIntervalMs ?? 5_000,
    };

    const positive = (name: string, v: number) => {
        if (!Number.isInteger(v) || v < 1) throw new Error(`IndexingConfig.${name} must be a positive integer`);
    };

    positive("lexicalConcurrency", resolved.lexicalConcurrency);
    if (semanticEnabled) 
        positive("semanticConcurrency", resolved.semanticConcurrency);

    positive("embeddingBatchSize", resolved.embeddingBatchSize);
    positive("retry.maxAttempts", resolved.retry.maxAttempts);
    if (resolved.activationStages.length === 0) 
        throw new Error("IndexingConfig.activationStages must not be empty");

    for (const s of resolved.activationStages) {
        if (!INDEX_STAGES.includes(s)) throw new Error(`unknown activation stage: ${s}`);
        if (s === "semantic" && !semanticEnabled) throw new Error("activationStages includes 'semantic' but no embeddingClient was provided");
    }

    if (resolved.chunking.overlapTokens >= resolved.chunking.maxTokens) 
        throw new Error("chunking.overlapTokens must be smaller than maxTokens");

    return resolved;
}
