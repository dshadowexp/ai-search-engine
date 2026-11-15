import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Frontier } from "./frontier.ts";
import { StaleLeaseError } from "./errors.ts";
import { healthy, setup } from "./helpers.test.ts";

describe("add()", () => {
    it("dedupes, rejects and reports", async () => {
        const { frontier } = setup();
        assert.equal(await frontier.add("https://example.com/about"), "added");
        assert.equal(await frontier.add("https://EXAMPLE.com/about#team"), "duplicate");
        assert.equal(await frontier.add("ftp://example.com/"), "invalid");
        assert.equal(await frontier.add("http://127.0.0.1/admin"), "rejected");
        const s = await frontier.getStats();
        assert.deepEqual([s.discovered, s.duplicates, s.invalid, s.rejected], [1, 1, 1, 1]);
    });

    it("applies backpressure", async () => {
        const { frontier } = setup({ maxPending: 2 });
        assert.equal(await frontier.add("https://a.com/1"), "added");
        assert.equal(await frontier.add("https://a.com/2"), "added");
        assert.equal(await frontier.add("https://a.com/3"), "backpressure");
        assert.equal(await frontier.add("https://a.com/1"), "duplicate");
    });
});

describe("retries and failures", () => {
    it("backs off exponentially and gives up at the limit", async () => {
        const { frontier, clock } = setup({ defaultCrawlDelayMs: 0, retry: { maxAttempts: 3, baseDelayMs: 2000 } });
        await frontier.add("https://e.com/flaky");

        const delays: number[] = [];
        for (let i = 0; i < 3; i++) {
            const l = (await frontier.claimNext("w"))!;
            assert.ok(l, `attempt ${i + 1}`);
            await frontier.acknowledge(l, { outcome: "retryable_failure", statusCode: 500 });
            if (i < 2) {
                const e = frontier.inspectEntry("https://e.com/flaky")!;
                delays.push(e.nextAttemptAt - clock.now());
                assert.equal(await frontier.claimNext("w"), null); // not before its retry time
                clock.advance(delays.at(-1)!);
            }
        }

        assert.deepEqual(delays, [2000, 4000]);
        assert.equal(frontier.inspectEntry("https://e.com/flaky")!.state, "failed");
        healthy(frontier);
    });

    it("a not-yet-due high-priority retry doesn't block due lower-priority URLs", async () => {
        const { frontier, clock } = setup({ defaultCrawlDelayMs: 0 });
        await frontier.add("https://e.com/hi", { priority: 10 });
        await frontier.add("https://e.com/lo", { priority: 1 });
        const hi = (await frontier.claimNext("w"))!;
        await frontier.acknowledge(hi, { outcome: "retryable_failure" });
        clock.advance(1);
        const next = (await frontier.claimNext("w"))!;
        assert.equal(new URL(next.url).pathname, "/lo");
    });

    it("429 Retry-After delays the whole host", async () => {
        const { frontier, clock } = setup({ defaultCrawlDelayMs: 0 });
        await frontier.add("https://e.com/a");
        await frontier.add("https://e.com/b");
        await frontier.acknowledge((await frontier.claimNext("w"))!, { outcome: "retryable_failure", statusCode: 429, retryAfterMs: 30_000 });
        clock.advance(29_999);
        assert.equal(await frontier.claimNext("w"), null);
        clock.advance(1);
        assert.ok(await frontier.claimNext("w"));
    });

    it("deferral doesn't consume an attempt; permanent failure is final", async () => {
        const { frontier, clock } = setup({ defaultCrawlDelayMs: 0 });
        await frontier.add("https://e.com/d");
        await frontier.acknowledge((await frontier.claimNext("w"))!, { outcome: "deferred", retryAfterMs: 5000 });
        const e = frontier.inspectEntry("https://e.com/d")!;
        assert.equal(e.state, "deferred");
        assert.equal(e.attempts, 0);
        clock.advance(5000);
        const l = (await frontier.claimNext("w"))!;
        assert.equal(frontier.inspectEntry("https://e.com/d")!.state, "leased");
        await frontier.acknowledge(l, { outcome: "permanent_failure", statusCode: 404 });
        assert.equal(frontier.inspectEntry("https://e.com/d")!.state, "failed");
    });
});

describe("discovery", () => {
    it("adds discovered links at depth+1 with lower priority, resolving relatives", async () => {
        const { frontier } = setup();
        await frontier.add("https://e.com/start/", { priority: 10 });
        await frontier.acknowledge((await frontier.claimNext("w"))!, { outcome: "success", discoveredLinks: ["page2", "/abs#frag", "mailto:x@y.com", "http://10.0.0.1/"] });
        const child = frontier.inspectEntry("https://e.com/start/page2")!;
        assert.equal(child.depth, 1);
        assert.equal(child.priority, 9);
        assert.ok(frontier.inspectEntry("https://e.com/abs"));
        assert.equal((await frontier.getStats()).pending, 2);
    });

    it("revalidates redirect targets (new host policy, SSRF)", async () => {
        const { frontier } = setup();
        await frontier.add("https://e.com/old");
        await frontier.acknowledge((await frontier.claimNext("w"))!, { outcome: "redirect", location: "https://other.com/new" });
        assert.ok(frontier.inspectHost("other.com"));
        await frontier.add("https://e.com/old2");
        await frontier.acknowledge((await frontier.claimNext("w"))!, { outcome: "redirect", location: "http://169.254.169.254/latest/meta-data" }).catch(() => {});
        assert.equal(frontier.inspectHost("169.254.169.254"), undefined);
    });
});

describe("invariants under load", () => {
    it("random workload keeps every invariant and never double-leases", async () => {
        const { frontier, clock } = setup({ defaultCrawlDelayMs: 50, maxConcurrencyPerHost: 3, leaseTtlMs: 500 });
        let seed = 42;
        const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
        for (let i = 0; i < 300; i++) 
            await frontier.add(`https://h${i % 7}.com/p${i}`, { priority: Math.floor(rnd() * 10) });

        const held: Awaited<ReturnType<Frontier["claimNext"]>>[] = [];
        const lastStart = new Map<string, number>();
        for (let step = 0; step < 3000; step++) {
            clock.advance(Math.floor(rnd() * 40));
            const r = rnd();
            if (r < 0.5) {
                const l = await frontier.claimNext(`w${step % 5}`);
                if (l) {
                    const prev = lastStart.get(l.hostId);
                    assert.ok(prev === undefined || clock.now() - prev >= 50, "crawl delay violated");
                    lastStart.set(l.hostId, clock.now());
                    held.push(l);
                }
            } else if (held.length) {
                const l = held.splice(Math.floor(rnd() * held.length), 1)[0]!;
                const outcome = rnd();
                try {
                    await frontier.acknowledge(l, outcome < 0.7 ? { outcome: "success" } : outcome < 0.9 ? { outcome: "retryable_failure", statusCode: 500 } : { outcome: "permanent_failure" });
                } catch (e) {
                    assert.ok(e instanceof StaleLeaseError); // expired leases are fenced, never corrupt state
                }
            }
            if (step % 100 === 0) healthy(frontier);
        }
        healthy(frontier);
    });
});
