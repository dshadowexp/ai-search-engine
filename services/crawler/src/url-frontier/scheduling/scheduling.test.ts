import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { healthy, setup } from "../helpers.test.ts";

describe("scheduling", () => {
    it("orders by priority within a host", async () => {
        const { frontier, clock } = setup({ defaultCrawlDelayMs: 0 });
        await frontier.add("https://e.com/blog", { priority: 5 });
        await frontier.add("https://e.com/about", { priority: 10 });
        await frontier.add("https://e.com/products", { priority: 8 });
        const order: string[] = [];
        for (let i = 0; i < 3; i++) {
        const l = (await frontier.claimNext("w"))!;
        order.push(new URL(l.url).pathname);
        await frontier.acknowledge(l, { outcome: "success" });
        clock.advance(1);
        }
        assert.deepEqual(order, ["/about", "/products", "/blog"]);
    });

    it("spreads capacity across hosts instead of hammering one", async () => {
        const { frontier } = setup({ maxConcurrencyPerHost: 4 });
        for (const p of ["/", "/about", "/products", "/blog"]) await frontier.add("https://example.com" + p);
        for (const p of ["/", "/articles"]) await frontier.add("https://another.com" + p);
        const a = (await frontier.claimNext("w1"))!;
        const b = (await frontier.claimNext("w2"))!;
        assert.notEqual(a.hostId, b.hostId);
        assert.equal(await frontier.claimNext("w3"), null); // both hosts are inside their crawl delay
        healthy(frontier);
    });

    it("enforces crawl delay (start-to-start)", async () => {
        const { frontier, clock } = setup({ maxConcurrencyPerHost: 5 });
        await frontier.add("https://e.com/1");
        await frontier.add("https://e.com/2");
        const first = (await frontier.claimNext("w"))!;
        assert.equal(await frontier.claimNext("w"), null);
        assert.equal(frontier.nextEligibleAt(), clock.now() + 1000);
        clock.advance(999);
        assert.equal(await frontier.claimNext("w"), null);
        clock.advance(1);
        assert.ok(await frontier.claimNext("w"));
        await frontier.acknowledge(first, { outcome: "success" });
        healthy(frontier);
    });

    it("enforces max concurrency independently of delay", async () => {
        const { frontier, clock } = setup({ defaultCrawlDelayMs: 0, maxConcurrencyPerHost: 2 });
        for (const n of [1, 2, 3]) await frontier.add(`https://e.com/${n}`);
        const a = (await frontier.claimNext("w"))!;
        const b = (await frontier.claimNext("w"))!;
        assert.equal(await frontier.claimNext("w"), null); // 2 in flight
        await frontier.acknowledge(a, { outcome: "success" });
        clock.advance(1);
        assert.ok(await frontier.claimNext("w"));
        assert.equal(frontier.inspectHost("e.com")!.inFlight, 2);
        await frontier.acknowledge(b, { outcome: "success" });
        healthy(frontier);
    });
});
