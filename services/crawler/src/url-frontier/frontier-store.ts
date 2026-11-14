import type { FrontierEntry, FrontierStore } from "./types.ts";

/**
 * Durable identity + lifecycle storage for URL records. The in-memory version backs Stage 1;
 * a PostgreSQL/Redis version replaces this (and the claim path) in later stages.
 * Terminal entries (fetched/failed) stay in the store: they are what prevents re-enqueueing.
 */
export class InMemoryFrontierStore implements FrontierStore {
    private readonly entries = new Map<string, FrontierEntry>();
    
    get size() {
        return this.entries.size;
    }

    get(id: string) {
        return this.entries.get(id);
    }

    has(id: string) {
        return this.entries.has(id);
    }

    put(entry: FrontierEntry) {
        this.entries.set(entry.id, entry);
    }
}