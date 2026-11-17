/**
 * Reciprocal Rank Fusion: combine RANKINGS, not scores (BM25 and cosine similarity are not comparable).
 * score(d) = sum over lists of 1 / (k + rank), rank starting at 1. k = 60 is the conventional constant.
 */
export function reciprocalRankFusion(rankings: readonly (readonly string[])[], k = 60): Map<string, number> {
    const scores = new Map<string, number>();
    for (const ranking of rankings) {
        ranking.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
    }
    return scores;
}
