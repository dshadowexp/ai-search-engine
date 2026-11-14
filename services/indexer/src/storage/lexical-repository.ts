export const FIELDS = ["title", "body"] as const;
export type Field = (typeof FIELDS)[number];
export type PerField<T> = Record<Field, T>;

export const perFieldZero = (): PerField<number> => ({ title: 0, body: 0 });

export interface TermEntry {
    tf: PerField<number>;
    positions: PerField<number[]>;
}

/** Everything the lexical index knows about one version of one document. */
export interface LexicalEntry {
    documentId: string;
    version: number;
    fieldLengths: PerField<number>;
    terms: Map<string, TermEntry>;
}

export interface Posting {
    documentId: string;
    version: number;
    tf: PerField<number>;
    positions: PerField<number[]>;
    fieldLengths: PerField<number>;
}

export interface CorpusStats {
    documentCount: number;
    avgFieldLength: PerField<number>;
}

/**
 * Postings are written per (document, version) but only the ACTIVE version of each document is
 * ever visible to reads, including corpus statistics. In SQL, activate() must be one transaction.
 */
export interface LexicalRepository {
    /** Idempotent: replaces any previous entry for this (document, version). Not searchable until activated. */
    putVersion(entry: LexicalEntry): Promise<void>;
    /** Makes this version the searchable one. Idempotent. False if it has no entry. */
    activate(documentId: string, version: number): Promise<boolean>;
    removeVersionsBefore(documentId: string, version: number): Promise<void>;
    getCorpusStats(): Promise<CorpusStats>;
    /** Active versions only. */
    getPostings(term: string): Promise<Posting[]>;
}

const keyOf = (documentId: string, version: number) => `${documentId}@${version}`;

export class InMemoryLexicalRepository implements LexicalRepository {
    private readonly entries = new Map<string, LexicalEntry>();
    private readonly versionsByDoc = new Map<string, Set<number>>();
    private readonly termIndex = new Map<string, Set<string>>(); // term -> entry keys (any version)
    private readonly active = new Map<string, number>();
    private activeLength: PerField<number> = { title: 0, body: 0 };

    async putVersion(entry: LexicalEntry): Promise<void> {
        const key = keyOf(entry.documentId, entry.version);
        const old = this.entries.get(key);
        if (old) 
            this.unindex(key, old);

        this.entries.set(key, entry);
        const versions = this.versionsByDoc.get(entry.documentId) ?? new Set<number>();
        versions.add(entry.version);
        this.versionsByDoc.set(entry.documentId, versions);

        for (const term of entry.terms.keys()) {
            const keys = this.termIndex.get(term) ?? new Set<string>();
            keys.add(key);
            this.termIndex.set(term, keys);
        }

        if (this.active.get(entry.documentId) === entry.version) {
            if (old) 
                this.addLengths(old.fieldLengths, -1);
            
            this.addLengths(entry.fieldLengths, 1);
        }
    }

    async activate(documentId: string, version: number): Promise<boolean> {
        const entry = this.entries.get(keyOf(documentId, version));
        if (!entry) 
            return false;

        const previous = this.active.get(documentId);
        if (previous === version) 
            return true;

        if (previous !== undefined) {
            const prev = this.entries.get(keyOf(documentId, previous));
            if (prev) this.addLengths(prev.fieldLengths, -1);
        }

        this.active.set(documentId, version);
        this.addLengths(entry.fieldLengths, 1);
        return true;
    }

    async removeVersionsBefore(documentId: string, version: number): Promise<void> {
        const versions = this.versionsByDoc.get(documentId);
        if (!versions) 
            return;

        for (const v of [...versions]) {
            if (v >= version) 
                continue;

            const key = keyOf(documentId, v);
            const entry = this.entries.get(key);
            if (entry) {
                if (this.active.get(documentId) === v) {
                    this.active.delete(documentId);
                    this.addLengths(entry.fieldLengths, -1);
                }

                this.unindex(key, entry);
                this.entries.delete(key);
            }
            versions.delete(v);
        }
    }

    async getCorpusStats(): Promise<CorpusStats> {
        const n = this.active.size;
        return {
            documentCount: n,
            avgFieldLength: { title: n ? this.activeLength.title / n : 0, body: n ? this.activeLength.body / n : 0 },
        };
    }

    async getPostings(term: string): Promise<Posting[]> {
        const out: Posting[] = [];

        for (const key of this.termIndex.get(term) ?? []) {
            const entry = this.entries.get(key)!;
            if (this.active.get(entry.documentId) !== entry.version) continue;
            const te = entry.terms.get(term)!;
            out.push({ documentId: entry.documentId, version: entry.version, tf: te.tf, positions: te.positions, fieldLengths: entry.fieldLengths });
        }

        return out;
    }

    // ---------------------------------- Private
    private unindex(key: string, entry: LexicalEntry): void {
        for (const term of entry.terms.keys()) {
            const keys = this.termIndex.get(term);
            keys?.delete(key);
            if (keys?.size === 0) this.termIndex.delete(term);
        }
    }

    private addLengths(l: PerField<number>, sign: 1 | -1): void {
        this.activeLength = { title: this.activeLength.title + sign * l.title, body: this.activeLength.body + sign * l.body };
    }
}
