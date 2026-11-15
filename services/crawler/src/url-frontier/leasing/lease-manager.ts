import { randomUUID } from "node:crypto";
import type { FrontierEntry, Lease } from "../types.js";
import { PriorityQueue } from "@search/core";

interface Expiry {
    entryId: string;
    token: string;
    expiresAt: number;
}

/**
 * Tracks active leases. Each lease carries a unique token, so a worker whose lease expired
 * (and whose URL was re-claimed) can never acknowledge it: its token no longer matches.
 * At most one active lease exists per entry by construction (Map keyed by entry id).
 */
export class LeaseManager {
    private readonly active = new Map<string, Lease>();
    private readonly expiries = new PriorityQueue<Expiry>((a, b) => a.expiresAt < b.expiresAt);
    private readonly ttlMs: number;

    constructor(ttlMs: number) {
        this.ttlMs = ttlMs;
    }

    get size(): number {
        return this.active.size;
    }

    grant(entry: FrontierEntry, workerId: string, now: number): Lease {
        const lease: Lease = {
            entryId: entry.id,
            url: entry.canonicalUrl,
            hostId: entry.hostId,
            workerId,
            token: randomUUID(),
            expiresAt: now + this.ttlMs,
            attempt: entry.attempts,
            depth: entry.depth,
        };
        this.active.set(entry.id, lease);
        this.expiries.push({ entryId: entry.id, token: lease.token, expiresAt: lease.expiresAt });
        return lease;
    }

    isActive(lease: Lease): boolean {
        return this.active.get(lease.entryId)?.token === lease.token;
    }

    /** Heartbeat for slow fetches. Returns the extended lease, or null if the lease is gone. */
    renew(lease: Lease, now: number): Lease | null {
        if (!this.isActive(lease)) return null;
        const renewed = { ...lease, expiresAt: now + this.ttlMs };
        this.active.set(lease.entryId, renewed);
        this.expiries.push({ entryId: lease.entryId, token: lease.token, expiresAt: renewed.expiresAt });
        return renewed;
    }

    release(lease: Lease): boolean {
        if (!this.isActive(lease)) return false;
        this.active.delete(lease.entryId);
        return true;
    }

    /** Removes and returns the ids of entries whose lease has expired. */
    collectExpired(now: number): string[] {
        const out: string[] = [];
        for (;;) {
        const top = this.expiries.peek();
        if (!top || top.expiresAt > now) return out;
        this.expiries.pop();
        const cur = this.active.get(top.entryId);
        // Skip heap items superseded by release() or renew().
        if (cur && cur.token === top.token && cur.expiresAt === top.expiresAt) {
            this.active.delete(top.entryId);
            out.push(top.entryId);
        }
        }
    }

    leases(): IterableIterator<Lease> {
        return this.active.values();
    }
}
