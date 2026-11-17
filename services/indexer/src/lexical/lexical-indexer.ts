import { LogStream } from "@search/infra";
import type { Analyzer, Token } from "../processor/analyzer.ts";
import { FIELDS, perFieldZero, type Field, type LexicalEntry, type LexicalRepository, type TermEntry } from "../storage/lexical-repository.ts";
import type { IndexDocument } from "../types.ts";

/** Field text: the title alone, and the description followed by the content. */
export function fieldTexts(doc: IndexDocument): Record<Field, string> {
    return { title: doc.title, body: doc.description ? `${doc.description}\n${doc.content}` : doc.content };
}

/** Pure: builds the per-field term frequencies and positions of one document version. */
export function buildLexicalEntry(doc: IndexDocument, analyzer: Analyzer): LexicalEntry {
    const terms = new Map<string, TermEntry>();
    const fieldLengths = perFieldZero();
    const texts = fieldTexts(doc);

    for (const field of FIELDS) {
        const tokens: Token[] = analyzer.analyze(texts[field]);
        fieldLengths[field] = tokens.length;
        for (const { term, position } of tokens) {
            let entry = terms.get(term);
            if (!entry) {
                entry = { tf: perFieldZero(), positions: { title: [], body: [] } };
                terms.set(term, entry);
            }
            entry.tf[field]++;
            entry.positions[field].push(position);
        }
    }

    return { documentId: doc.id, version: doc.version, fieldLengths, terms };
}

export class LexicalIndexer {
    private readonly analyzer: Analyzer;
    private readonly repository: LexicalRepository;

    constructor(
        analyzer: Analyzer,
        repository: LexicalRepository,
    ) {
        this.analyzer = analyzer;
        this.repository = repository;
    }

    /** Idempotent: re-running replaces this version's postings, never duplicates them. */
    async index(doc: IndexDocument): Promise<{ terms: number }> {
        const entry = buildLexicalEntry(doc, this.analyzer);
        await this.repository.putVersion(entry);
        return { terms: entry.terms.size };
    }
}
