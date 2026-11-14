import { FIELDS, type PerField } from "../storage/lexical-repository.js";

export interface Bm25Params {
    k1: number;
    /** Length normalisation per field (0 = none, 1 = full). */
    b: PerField<number>;
    /** How much a hit in each field is worth. */
    weights: PerField<number>;
}

export const DEFAULT_BM25: Bm25Params = {
    k1: 1.2,
    b: { title: 0.5, body: 0.75 },
    weights: { title: 3, body: 1 },
};