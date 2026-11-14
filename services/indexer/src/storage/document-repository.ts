import type { DocumentRecord, IndexDocument } from "../types.js";

/** Durable home of document versions. In SQL: (document_id, version) is UNIQUE, active_version lives on the document row. */
export interface DocumentRepository {
    get(id: string): Promise<DocumentRecord | undefined>;
    getVersion(id: string, version: number): Promise<IndexDocument | undefined>;
    /** Atomic compare-and-append: succeeds only if the latest version is still `expectedLatest` (0 = none). */
    appendVersion(doc: IndexDocument, expectedLatest: number): Promise<boolean>;
    updateMetadata(id: string, version: number, patch: { declaredCanonicalUrl?: string | undefined; fetchedAt?: number | undefined }): Promise<void>;
    /** Monotonic: never moves backwards. Returns whether the active version changed. */
    setActiveVersion(id: string, version: number, at: number): Promise<boolean>;
    removeVersionsBefore(id: string, version: number): Promise<void>;
    listActive(): Promise<{ id: string; activeVersion: number }[]>;
}

export class InMemoryDocumentRepository implements DocumentRepository {
    private readonly records = new Map<string, DocumentRecord>();
    private readonly versions = new Map<string, Map<number, IndexDocument>>();

    get size(): number {
        return this.records.size;
    }

    async get(id: string) {
        const r = this.records.get(id);
        return r ? { ...r } : undefined;
    }

    async getVersion(id: string, version: number) {
        return this.versions.get(id)?.get(version);
    }

    async appendVersion(doc: IndexDocument, expectedLatest: number): Promise<boolean> {
        const rec = this.records.get(doc.id);
        if ((rec?.latestVersion ?? 0) !== expectedLatest) return false;
        if (rec) rec.latestVersion = doc.version;
        else this.records.set(doc.id, { id: doc.id, url: doc.url, latestVersion: doc.version, activeVersion: null, activatedAt: null });
        const map = this.versions.get(doc.id) ?? new Map<number, IndexDocument>();
        map.set(doc.version, doc);
        this.versions.set(doc.id, map);
        return true;
    }

    async updateMetadata(id: string, version: number, patch: { declaredCanonicalUrl?: string; fetchedAt?: number }) {
        const doc = this.versions.get(id)?.get(version);
        if (!doc) 
            return;
        
        if (patch.declaredCanonicalUrl !== undefined) 
            doc.declaredCanonicalUrl = patch.declaredCanonicalUrl;

        if (patch.fetchedAt !== undefined) 
            doc.fetchedAt = Math.max(doc.fetchedAt, patch.fetchedAt);
    }

    async setActiveVersion(id: string, version: number, at: number): Promise<boolean> {
        const rec = this.records.get(id);
        if (!rec || (rec.activeVersion !== null && version <= rec.activeVersion)) 
            return false;

        rec.activeVersion = version;
        rec.activatedAt = at;
        return true;
    }

    async removeVersionsBefore(id: string, version: number): Promise<void> {
        const map = this.versions.get(id);
        if (!map) 
            return;

        for (const v of [...map.keys()]) 
            if (v < version) 
                map.delete(v);
    }

    async listActive() {
        return [...this.records.values()].filter((r) => r.activeVersion !== null).map((r) => ({ id: r.id, activeVersion: r.activeVersion as number }));
    }
}