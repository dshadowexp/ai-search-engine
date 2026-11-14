export class PriorityQueue<T> {
    private items: T[] = [];

    constructor(private readonly before: (a: T, b: T) => boolean) {}

    get size(): number {
        return this.items.length;
    }

    peek(): T | undefined {
        return this.items[0];
    }

    push(item: T): void {

    }

    pop(): T | undefined {
        return undefined;
    }

    private siftUp() {

    }

    private shiftDown() {

    }
}