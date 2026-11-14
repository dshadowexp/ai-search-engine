import type { FrontierEntry } from "../types.js";
import { PriorityQueue } from "@search/shared";

interface Slot {
    entry: FrontierEntry;
    seq: number;
}

export class HostQueue {
    private seq = 0;
    private readonly ready = new PriorityQueue<Slot>((a, b) => {
        if (a.entry.priority !== b.entry.priority) 
            return a.entry.priority > b.entry.priority;
        if (a.entry.depth !== b.entry.depth) 
            return a.entry.depth < b.entry.depth;
        return a.seq < b.seq;
    });
    private readonly delayed = new PriorityQueue<Slot>((a, b) => {
        if (a.entry.nextAttemptAt !== b.entry.nextAttemptAt) 
            return a.entry.nextAttemptAt < b.entry.nextAttemptAt;
        return a.seq < b.seq;
    });
    private readonly onPromote: ((entry: FrontierEntry) => void) | undefined;

    constructor(onPromote?: (entry: FrontierEntry) => void) {
        this.onPromote = onPromote;
    }

    get size(): number {
        return this.ready.size + this.delayed.size;
    }

    push(entry: FrontierEntry, now: number): void {
        const slot = { entry, seq: this.seq++ };
        if (entry.nextAttemptAt > now) this.delayed.push(slot);
        else this.ready.push(slot);
    }

    popReady(now: number): FrontierEntry | null {
        this.promote(now);
        return this.ready.pop()?.entry ?? null;
    }

    earliestReadyAt(): number | null {
        if (this.ready.size > 0) 
            return Number.NEGATIVE_INFINITY;
        const d = this.delayed.peek();
        return d ? d.entry.nextAttemptAt : null;
    }

    private promote(now: number): void {
        for (;;) {
            const top = this.delayed.peek();
            if (!top || top.entry.nextAttemptAt > now) return;
            this.delayed.pop();
            this.onPromote?.(top.entry);
            this.ready.push(top);
        }
    }
}