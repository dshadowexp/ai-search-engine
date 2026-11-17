import { DEFAULT_BM25, type Bm25Params } from "./lexical/bm25.ts";
import type { PerField } from "./storage/lexical-repository.ts";

export interface IndexingConfig {
    /** Injectable clock (ms), as in the frontier and crawler. */
    now?: () => number;
    /** Number of workers indexing lexical postings. */
    lexicalConcurrency?: number;
    leaseTtlMs?: number;
    retry?: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number };
    maxContentChars?: number;
    bm25?: { k1?: number; b?: Partial<PerField<number>>; weights?: Partial<PerField<number>> };
    idlePollMs?: number;
    /** How often unpublished (completed but not yet searchable) stages are re-examined. */
    reconcileIntervalMs?: number;
}

export interface ResolvedIndexingConfig {
    now: () => number;
    lexicalConcurrency: number;
    leaseTtlMs: number;
    retry: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number };
    maxContentChars: number;
    bm25: Bm25Params;
    idlePollMs: number;
    reconcileIntervalMs: number;
}

export function resolveIndexingConfig(cfg: IndexingConfig): ResolvedIndexingConfig {
    const resolved: ResolvedIndexingConfig = {
        now: cfg.now ?? Date.now,
        lexicalConcurrency: cfg.lexicalConcurrency ?? 2,
        leaseTtlMs: cfg.leaseTtlMs ?? 60_000,
        retry: {
            maxAttempts: cfg.retry?.maxAttempts ?? 5,
            baseDelayMs: cfg.retry?.baseDelayMs ?? 1_000,
            maxDelayMs: cfg.retry?.maxDelayMs ?? 300_000,
        },
        maxContentChars: cfg.maxContentChars ?? 1_000_000,
        bm25: {
            k1: cfg.bm25?.k1 ?? DEFAULT_BM25.k1,
            b: { ...DEFAULT_BM25.b, ...cfg.bm25?.b },
            weights: { ...DEFAULT_BM25.weights, ...cfg.bm25?.weights },
        },
        idlePollMs: cfg.idlePollMs ?? 250,
        reconcileIntervalMs: cfg.reconcileIntervalMs ?? 5_000,
    };

    const positive = (name: string, v: number) => {
        if (!Number.isInteger(v) || v < 1) throw new Error(`IndexingConfig.${name} must be a positive integer`);
    };

    positive("lexicalConcurrency", resolved.lexicalConcurrency);
    positive("retry.maxAttempts", resolved.retry.maxAttempts);

    return resolved;
}
