import { bm25fScore, type Bm25Params, DEFAULT_BM25, idf } from "../lexical/bm25.ts";
import type { Analyzer } from "../processor/analyzer.ts";
import type { DocumentRepository } from "../storage/document-repository.ts";
import type { LexicalRepository } from "../storage/lexical-repository.ts";
import { makeSnippet } from "./snippet.ts";

export interface SearchOptions {
    limit?: number;
    /** Maximum lexical results to fetch before hydrating documents. */
    candidateLimit?: number;
}

export interface SearchHit {
    documentId: string;
    url: string;
    title: string;
    snippet: string;
    /** BM25F score from lexical search. */
    score: number;
}

export interface SearchResponse {
    hits: SearchHit[];
}

interface LexicalHit {
    documentId: string;
    version: number;
    score: number;
}

export interface LexicalSearchServiceDependencies {
    documents: DocumentRepository;
    analyzer: Analyzer;
    lexical: LexicalRepository;
    bm25?: Bm25Params;
}

/** Searches the BM25F index and hydrates ranked results into API-ready document hits. */
export class LexicalSearchService {
    private readonly documents: DocumentRepository;
    private readonly analyzer: Analyzer;
    private readonly lexical: LexicalRepository;
    private readonly bm25: Bm25Params;

    constructor(
        deps: LexicalSearchServiceDependencies,
    ) {
        this.documents = deps.documents;
        this.analyzer = deps.analyzer;
        this.lexical = deps.lexical;
        this.bm25 = deps.bm25 ?? DEFAULT_BM25;
    }

    async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
        const limit = options.limit ?? 10;
        const candidateLimit = options.candidateLimit ?? Math.max(50, limit * 5);
        const terms = [...new Set(this.analyzer.analyze(query).map((t) => t.term))];
        if (terms.length === 0) return { hits: [] };

        const lexicalHits = await this.rank(terms, candidateLimit);
        const hits: SearchHit[] = [];
        for (const lexicalHit of lexicalHits) {
            if (hits.length >= limit) 
                break;

            const doc = await this.documents.getVersion(lexicalHit.documentId, lexicalHit.version);
            if (!doc) 
                continue; // retired between retrieval and hydration

            const source = `${doc.description ?? ""}\n${doc.content}`;
            hits.push({
                documentId: lexicalHit.documentId,
                url: doc.url,
                title: doc.title,
                snippet: makeSnippet(source, terms),
                score: lexicalHit.score,
            });
        }

        return { hits };
    }

    private async rank(terms: readonly string[], limit: number): Promise<LexicalHit[]> {
        const stats = await this.lexical.getCorpusStats();
        if (stats.documentCount === 0) return [];

        const scores = new Map<string, LexicalHit>();
        for (const term of terms) {
            const postings = await this.lexical.getPostings(term);
            if (postings.length === 0) continue;

            const termIdf = idf(stats.documentCount, postings.length);
            for (const posting of postings) {
                const gained = bm25fScore(
                    posting.tf,
                    posting.fieldLengths,
                    stats.avgFieldLength,
                    termIdf,
                    this.bm25,
                );
                const hit = scores.get(posting.documentId);
                if (hit) hit.score += gained;
                else {
                    scores.set(posting.documentId, {
                        documentId: posting.documentId,
                        version: posting.version,
                        score: gained,
                    });
                }
            }
        }

        return [...scores.values()]
            .sort((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId))
            .slice(0, limit);
    }
}
