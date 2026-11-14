export type IndexStage = "lexical" | "semantic";
export const INDEX_STAGES: readonly IndexStage[] = ["lexical", "semantic"];

/** pending also covers "waiting for a retry"; failed is terminal (dead-letter, inspectable). */
export type StageStatus = "pending" | "processing" | "completed" | "failed" | "skipped";

/** What the search engine operates on. Derived from a CrawledDocument; knows nothing about HTML or HTTP. */
export interface IndexDocument {
    id: string; // sha256 of the canonical URL: the same id the frontier uses for this URL
    url: string;
    declaredCanonicalUrl?: string | undefined;
    title: string;
    description: string | null;
    content: string;
    language: string; // primary subtag, or "und"
    contentHash: string; // over title, description, content, language (NOT metadata)
    version: number;
    fetchedAt: number;
    createdAt: number;
}

export interface DocumentRecord {
    id: string;
    url: string;
    latestVersion: number;
    /** The version search sees. null until a version has finished its activation stages. */
    activeVersion: number | null;
    activatedAt: number | null;
}

export interface StageState {
    status: StageStatus;
    attempts: number;
    nextAttemptAt: number;
    lease?: { workerId: string; token: string; expiresAt: number };
    lastError?: string;
    /** Completed AND its result has been made searchable (or retired). Unpublished stages are reconciled. */
    published: boolean;
    updatedAt: number;
}

export interface IndexJob {
    id: string; // `${documentId}@${version}`
    documentId: string;
    version: number;
    stages: Record<IndexStage, StageState>;
    createdAt: number;
}

/** What a worker holds while it runs one stage of one document version. */
export interface StageLease {
    jobId: string;
    documentId: string;
    version: number;
    stage: IndexStage;
    workerId: string;
    token: string;
    expiresAt: number;
    attempt: number;
}

export type IngestStatus = "created" | "new_version" | "unchanged" | "stale" | "rejected";

export interface IngestResult {
    status: IngestStatus;
    documentId?: string;
    version?: number;
    reason?: string;
    /** unchanged content, but canonical URL / fetch time were refreshed */
    metadataUpdated?: boolean;
}

export interface IngestStats {
    received: number;
    created: number;
    newVersions: number;
    unchanged: number;
    metadataUpdates: number;
    stale: number;
    rejected: number;
}

export interface IndexingStats {
    stagesCompleted: Record<IndexStage, number>;
    retries: number;
    deadLettered: number;
    staleLeases: number;
    shutdownReleases: number;
    obsoleteStages: number;
    publishFailures: number;
    activations: number;
    internalErrors: number;
    activeJobs: number;
}

export interface JobStats {
    stages: Record<IndexStage, Record<StageStatus, number>>;
    unpublished: number;
}

export class StaleStageLeaseError extends Error {
    constructor(lease: StageLease) {
        super(`Lease for ${lease.stage} stage of ${lease.jobId} is no longer valid`);
        this.name = "StaleStageLeaseError";
    }
}
