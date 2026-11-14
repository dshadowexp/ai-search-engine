export interface ChunkerConfig {
    /** Approximate tokens per chunk (words * 1.3). Starting values; tune against your own search quality. */
    maxTokens: number;
    overlapTokens: number;
}

export interface Chunk {
    index: number;
    content: string;
    tokenEstimate: number;
}

const TOKENS_PER_WORD = 1.3;

export const estimateTokens = (text: string): number => Math.ceil(text.split(/\s+/).filter(Boolean).length * TOKENS_PER_WORD);

interface Unit {
    text: string;
    tokens: number;
}

/**
 * Packs whole lines (paragraphs, headings, list items: the crawler emits one block per line)
 * into chunks of at most maxTokens, carrying whole trailing lines over as overlap.
 * Lines that are too long are split at sentence boundaries, then by words as a last resort.
 * Deterministic: the same text always yields the same chunks (so re-embedding is idempotent).
 */
export function chunkText(text: string, cfg: ChunkerConfig): Chunk[] {
    const max = cfg.maxTokens;
    const overlap = Math.min(cfg.overlapTokens, Math.floor(max / 2));
    const chunks: Chunk[] = [];
    let cur: Unit[] = [];
    let curTokens = 0;
    let fresh = 0; // units in `cur` that no emitted chunk contains yet

    const emit = () => {
        if (fresh > 0) chunks.push({ index: chunks.length, content: cur.map((u) => u.text).join("\n"), tokenEstimate: curTokens });
    };

    for (const unit of toUnits(text, max)) {
        if (curTokens + unit.tokens > max && fresh > 0) {
            emit();
            const keep: Unit[] = [];
            let sum = 0;
            for (let i = cur.length - 1; i >= 0 && sum + cur[i].tokens <= overlap; i--) {
                keep.unshift(cur[i]);
                sum += cur[i].tokens;
            }
            cur = sum + unit.tokens <= max ? keep : [];
            curTokens = cur.reduce((s, u) => s + u.tokens, 0);
            fresh = 0;
        }
        cur.push(unit);
        curTokens += unit.tokens;
        fresh++;
    }
    emit();
    return chunks;
}

function toUnits(text: string, max: number): Unit[] {
    const units: Unit[] = [];
    for (const line of text.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        const tokens = estimateTokens(t);
        if (tokens <= max) units.push({ text: t, tokens });
        else for (const piece of splitLong(t, max)) units.push({ text: piece, tokens: estimateTokens(piece) });
    }
    return units;
}

function splitLong(text: string, max: number): string[] {
    const pieces: string[] = [];
    let cur: string[] = [];
    let curTokens = 0;
    const flush = () => {
        if (cur.length) pieces.push(cur.join(" "));
        cur = [];
        curTokens = 0;
    };

    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
        const tokens = estimateTokens(sentence);
        if (tokens > max) {
            flush();
            const words = sentence.split(/\s+/).filter(Boolean);
            const step = Math.max(1, Math.floor(max / TOKENS_PER_WORD));
            for (let i = 0; i < words.length; i += step) pieces.push(words.slice(i, i + step).join(" "));
            continue;
        }

        if (curTokens + tokens > max) 
            flush();

        cur.push(sentence);
        curTokens += tokens;
    }
    
    flush();
    return pieces;
}