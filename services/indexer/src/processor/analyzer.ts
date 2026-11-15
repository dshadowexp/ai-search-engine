export interface Token {
    term: string;
    /** Word position. Several terms may share one (a compound and its first part). */
    position: number;
}


/** The same analyzer must be used to index documents and to analyze queries. */
export interface Analyzer {
    analyze(text: string): Token[];
}

// A word: letters/digits, optionally joined by . - _ / ' (node.js, state-of-the-art, don't),
// optionally ending in ++ + # when it follows a letter and isn't glued to more word chars (c++, c#).
const WORD = /[\p{L}\p{N}]+(?:[.\-_/'’][\p{L}\p{N}]+)*(?:(?<=\p{L})(?:\+\+|\+|#)(?![\p{L}\p{N}+#]))?/gu;

/**
 * Unicode-aware tokenizer that keeps technical terms intact while staying recallable:
 *   "Node.js" -> node.js (pos 0), node (pos 0), js (pos 1)      so "node", "js" and "node.js" all match
 *   "C++"     -> c++                                            and does NOT also emit a bare "c"
 *   "don't"   -> dont
 * Deliberately NOT done yet: stop-word removal (BM25's IDF handles it and phrases stay intact),
 * stemming/lemmatization, and word segmentation for CJK scripts.
 */
export class StandardAnalyzer implements Analyzer {
    private readonly maxTokenLength: number;
    
    constructor(maxTokenLength: number = 64) {
        this.maxTokenLength = maxTokenLength;
    }

    analyze(text: string): Token[] {
        const out: Token[] = [];
        let position = 0;
        for (const m of text.normalize("NFKC").toLowerCase().matchAll(WORD)) {
            const surface = m[0].replace(/['’]/g, "");
            if (!surface || surface.length > this.maxTokenLength) 
                continue;

            if (/(\+\+|\+|#)$/.test(surface)) {
                out.push({ term: surface, position: position++ });
                continue;
            }

            const parts = surface.split(/[.\-_/]/).filter(Boolean);
            if (parts.length <= 1) {
                out.push({ term: parts[0] ?? surface, position: position++ });
                continue;
            }

            out.push({ term: surface, position });
            parts.forEach((part, i) => out.push({ term: part, position: position + i }));
            position += parts.length;
        }
        return out;
    }
}

export const standardAnalyzer = new StandardAnalyzer();
export const tokenize = (text: string): Token[] => standardAnalyzer.analyze(text);
