export interface IndexDocument {
    id: string;
    url: string;
    title: string;
    description: string | null;
    content: string;
    language: string;
    contentHash: string;
    version: number;
    indexedAt: Date;
}

interface Posting {
    documentId: string;
    termFrequency: number;
    positions?: number[];
}

interface InvertedIndex {
    [term: string]: Posting[];
}

type IndexingStatus =
    | "pending"
    | "processing"
    | "completed"
    | "failed";

interface DocumentIndexState {
    documentId: string;
    documentVersion: number;
    lexicalStatus: IndexingStatus;
    semanticStatus: IndexingStatus;
}