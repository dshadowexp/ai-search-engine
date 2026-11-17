import { FIELDS, type PerField } from "../storage/lexical-repository.ts";

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

/** Rare terms count more. The +1 keeps it positive even for terms in more than half the corpus. */
export function idf(documentCount: number, documentFrequency: number): number {
    return Math.log(1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
}

/**
 * BM25F: combine weighted, length-normalised term frequencies across fields FIRST, then saturate.
 * With a single field and weight 1 this is exactly classic BM25.
 */
export function bm25fScore(
    tf: PerField<number>,
    fieldLengths: PerField<number>,
    avgFieldLengths: PerField<number>,
    idfValue: number,
    p: Bm25Params,
): number {
    let pseudoTf = 0;
    for (const f of FIELDS) {
        if (tf[f] === 0) 
            continue;
        
        const ratio = avgFieldLengths[f] > 0 ? fieldLengths[f] / avgFieldLengths[f] : 1;
        pseudoTf += (p.weights[f] * tf[f]) / (1 - p.b[f] + p.b[f] * ratio);
    }
    return (idfValue * pseudoTf) / (p.k1 + pseudoTf);
}
