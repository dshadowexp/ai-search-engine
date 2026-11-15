import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { healthy, setup } from "../helpers.test.ts";
import { StaleLeaseError } from "../errors.ts";

describe("leases", () => {
    it("recovers a crashed worker's URL and fences the stale worker", async () => {
        const { frontier, clock } = setup({ leaseTtlMs: 30_000 });
        await frontier.add("https://e.com/page");
        const a = (await frontier.claimNext("A"))!;
        clock.advance(30_001);
        const b = (await frontier.claimNext("B"))!; // reaps A's lease, re-leases to B
        assert.equal(b.entryId, a.entryId);
        assert.notEqual(a.token, b.token);
        await assert.rejects(frontier.acknowledge(a, { outcome: "success" }), StaleLeaseError);
        await frontier.acknowledge(b, { outcome: "success" });
        assert.equal(frontier.inspectEntry("https://e.com/page")!.state, "fetched");
        assert.equal((await frontier.getStats()).expiredLeases, 1);
        healthy(frontier);
    });

    it("renewLease extends the deadline", async () => {
        const { frontier, clock } = setup({ leaseTtlMs: 10_000 });
        await frontier.add("https://e.com/slow");
        let lease = (await frontier.claimNext("A"))!;
        clock.advance(8_000);
        lease = await frontier.renewLease(lease);
        clock.advance(8_000);
        assert.equal(frontier.reapExpiredLeases(), 0);
        clock.advance(3_000);
        assert.equal(frontier.reapExpiredLeases(), 1);
    });

    it("release() requeues without burning an attempt", async () => {
        const { frontier, clock } = setup({ defaultCrawlDelayMs: 0 });
        await frontier.add("https://e.com/x");
        const l = (await frontier.claimNext("A"))!;
        await frontier.release(l, "shutdown");
        clock.advance(1);
        const l2 = (await frontier.claimNext("B"))!;
        assert.equal(l2.attempt, 1);
        healthy(frontier);
    });

    it("never lets a completed URL be re-enqueued", async () => {
        const { frontier } = setup();
        await frontier.add("https://e.com/done");
        await frontier.acknowledge((await frontier.claimNext("w"))!, { outcome: "success" });
        assert.equal(await frontier.add("https://e.com/done"), "duplicate");
    });
});