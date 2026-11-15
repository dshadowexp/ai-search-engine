export class PriorityQueue<T> {
    private items: T[] = [];
    private readonly before: (a: T, b: T) => boolean;

    constructor(before: (a: T, b: T) => boolean) {
        this.before = before;
    }

    get size(): number {
        return this.items.length;
    }

    peek(): T | undefined {
        return this.items[0];
    }

    push(item: T): void {
        this.items.push(item);
        this.siftUp(this.items.length - 1);
    }

    pop(): T | undefined {
        const n = this.items.length;
        if (n === 0) return undefined;
        const top = this.items[0];
        const last = this.items.pop() as T;
        if (n > 1) {
            this.items[0] = last;
            this.siftDown(0);
        }
        return top;
    }

    private siftUp(i: number): void {
        const items = this.items;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (!this.before(items[i]!, items[parent]!)) 
                break;
            [items[i], items[parent]] = [items[parent], items[i]];
            i = parent;
        }
    }

    private siftDown(i: number): void {
        const items = this.items;
        const n = items.length;
        for (;;) {
            const l = 2 * i + 1;
            const r = l + 1;
            let best = i;
            if (l < n && this.before(items[l]!, items[best]!)) best = l;
            if (r < n && this.before(items[r]!, items[best]!)) best = r;
            if (best === i) return;
            [items[i], items[best]] = [items[best], items[i]];
            i = best;
        }
    }
}
