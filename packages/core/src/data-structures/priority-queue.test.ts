import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PriorityQueue } from "./priority-queue.ts";

describe("priority queue", () => {
    it("pops in order", () => {
        const q = new PriorityQueue<number>((a, b) => a < b);
        [5, 1, 9, 3, 7, 2].forEach((n) => q.push(n));
        const out: number[] = [];
        while (q.size) out.push(q.pop()!);
        assert.deepEqual(out, [1, 2, 3, 5, 7, 9]);
    });
});