import { PriorityQueue } from "@search/core";

interface Slot {
    hostId: string;
    at: number;
}

/**
 * Global min-heap of hosts ordered by nextEligibleAt, O(log H) per operation.
 * Rescheduling uses lazy invalidation: `current` holds each host's live slot, and
 * superseded heap slots are discarded when they surface.
 */
export class HostScheduler {
    private heap = this.newHeap();
    private readonly current = new Map<string, Slot>();

    get size(): number {
        return this.current.size;
    }

    schedule(hostId: string, at: number): void {
        const slot = { hostId, at };
        this.current.set(hostId, slot);
        this.heap.push(slot);
        if (this.heap.size > 4 * this.current.size + 1024) this.compact();
    }

    unschedule(hostId: string): void {
        this.current.delete(hostId);
    }

    /** Removes and returns a host whose time has come, or null. */
    popEligible(now: number): string | null {
        for (;;) {
            const top = this.heap.peek();
            if (!top) return null;
            if (this.current.get(top.hostId) !== top) {
                this.heap.pop();
                continue;
            }
            if (top.at > now) return null;
            this.heap.pop();
            this.current.delete(top.hostId);
            return top.hostId;
        }
    }

    /** Time the earliest scheduled host becomes eligible (workers can sleep until then). */
    nextEligibleAt(): number | null {
        for (;;) {
            const top = this.heap.peek();
            if (!top) return null;
            if (this.current.get(top.hostId) !== top) {
                this.heap.pop();
                continue;
            }
            return top.at;
        }
    }

    private compact(): void {
        this.heap = this.newHeap();
        for (const slot of this.current.values()) 
            this.heap.push(slot);
    }

    private newHeap(): PriorityQueue<Slot> {
        return new PriorityQueue<Slot>((a, b) => a.at < b.at);
    }
}
