import { normalizeUrl, hashUrl, type CrawledDocument } from "@search/core";
import { hashContent } from "../processor/content-hasher.ts";
import { normalizeLanguage, normalizeText } from "../processor/normalizer.ts";
import type { DocumentRepository } from "../storage/document-repository.ts";
import type { IndexJobStore } from "../storage/job-store.ts";
import type { IndexDocument, IngestResult, IngestStats } from "../types.ts";

export interface IngestorDependencies {
    documents: DocumentRepository; 
    jobs: IndexJobStore;
}

export interface IngestorConfig {
    now: () => number;
    maxContentChars: number;
}

type Prepared = { ok: true; url: string; title: string; description: string | null; content: string; language: string } | { ok: false; reason: string };

/**
 * CrawledDocument -> IndexDocument + a lexical indexing job. It only records what must be indexed.
 */
export class DocumentIngestor {
    private readonly deps: IngestorDependencies;
    private readonly cfg: IngestorConfig;
    readonly stats: IngestStats;

    constructor(
        deps: IngestorDependencies,
        cfg: IngestorConfig,
        stats: IngestStats
    ) {
        this.deps = deps;
        this.cfg = cfg;
        this.stats = stats;
    }

    async ingest(crawled: CrawledDocument): Promise<IngestResult> {
        this.stats.received++;
        const prepared = this.prepare(crawled);
        if (!prepared.ok) {
            this.stats.rejected++;
            return { status: "rejected", reason: prepared.reason };
        }

        const id = hashUrl(prepared.url);
        const contentHash = hashContent([prepared.title, prepared.description ?? "", prepared.content, prepared.language]);

        for (let attempt = 0; attempt < 3; attempt++) {
            const record = await this.deps.documents.get(id);
            const latest = record ? await this.deps.documents.getVersion(id, record.latestVersion) : undefined;

            if (latest) {
                if (crawled.fetchedAt < latest.fetchedAt) {
                    this.stats.stale++;
                    return { 
                        status: "stale", 
                        documentId: id, 
                        version: latest.version, 
                        reason: "an older fetch arrived after a newer one" 
                    };
                }

                if (latest.contentHash === contentHash) 
                    return this.unchanged(id, latest, crawled);
            }

            const version = (record?.latestVersion ?? 0) + 1;
            const doc: IndexDocument = {
                id,
                url: prepared.url,
                declaredCanonicalUrl: crawled.declaredCanonicalUrl,
                title: prepared.title,
                description: prepared.description,
                content: prepared.content,
                language: prepared.language,
                contentHash,
                version,
                fetchedAt: crawled.fetchedAt,
                createdAt: this.cfg.now(),
            };

            if (!(await this.deps.documents.appendVersion(doc, record?.latestVersion ?? 0))) 
                continue; // lost a race: re-read

            await this.deps.jobs.enqueue(id, version, { lexical: "pending" });
            if (record) this.stats.newVersions++;
            else this.stats.created++;

            return { status: record ? "new_version" : "created", documentId: id, version };
        }

        throw new Error(`ingestion conflict: too many concurrent updates of ${prepared.url}`);
    }

    /** Same text: no new version and no downstream work, but metadata still moves, and a lost job is healed. */
    private async unchanged(id: string, latest: IndexDocument, crawled: CrawledDocument): Promise<IngestResult> {
        this.stats.unchanged++;
        const metadataChanged = crawled.declaredCanonicalUrl !== undefined && crawled.declaredCanonicalUrl !== latest.declaredCanonicalUrl;
        await this.deps.documents.updateMetadata(id, latest.version, { declaredCanonicalUrl: crawled.declaredCanonicalUrl, fetchedAt: crawled.fetchedAt });
        if (metadataChanged) this.stats.metadataUpdates++;

        // A crash between appendVersion and enqueue would leave a version nobody indexes: re-crawling heals it.
        if (!(await this.deps.jobs.get(id, latest.version))) {
            await this.deps.jobs.enqueue(id, latest.version, { lexical: "pending" });
        }
        return { status: "unchanged", documentId: id, version: latest.version, metadataUpdated: metadataChanged };
    }

    private prepare(crawled: CrawledDocument): Prepared {
        const url = Number.isFinite(crawled.fetchedAt) ? normalizeUrl(crawled.url) : null;
        if (!url) 
            return { ok: false, reason: "invalid url or fetchedAt" };

        const content = normalizeText(crawled.textContent ?? "").slice(0, this.cfg.maxContentChars);
        if (!content) 
            return { ok: false, reason: "empty content" };

        const description = normalizeText(crawled.description ?? "") || null;
        const title = normalizeText(crawled.title ?? "").replace(/\n+/g, " ") || url;
        return { ok: true, url, title, description, content, language: normalizeLanguage(crawled.language) };
    }
}
