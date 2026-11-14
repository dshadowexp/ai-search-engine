import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRobotsTxt, type RobotsPolicy } from "./robots-policy.ts";
import { flush, healthy, setup } from "../helpers.ts";

describe("robots.txt", () => {
    const robotsTxt = `User-agent: *\nDisallow: /private/\nAllow: /private/public\nCrawl-delay: 5\n`;
    const policy: RobotsPolicy = { load: async () => parseRobotsTxt(robotsTxt, "TestBot/1.0") };

    it("parser: longest match wins, wildcards, crawl-delay, agent specificity", () => {
        const r = parseRobotsTxt(`User-agent: *\nDisallow: /a\nUser-agent: testbot\nDisallow: /*.pdf$\nAllow: /x\nDisallow: /x/y\nCrawl-delay: 2`, "TestBot/1.0");
        assert.equal(r.isAllowed("https://e.com/a"), true); // testbot group, not *
        assert.equal(r.isAllowed("https://e.com/doc.pdf"), false);
        assert.equal(r.isAllowed("https://e.com/doc.pdf?x=1"), true);
        assert.equal(r.isAllowed("https://e.com/x/y/z"), false);
        assert.equal(r.crawlDelayMs, 2000);
    });

    it("disallowed URLs never reach a worker; Crawl-delay is applied", async () => {
        const { frontier, clock } = setup({ robots: policy, defaultCrawlDelayMs: 1000, maxConcurrencyPerHost: 5 });
        await frontier.add("https://e.com/private/secret", { priority: 100 });
        await frontier.add("https://e.com/private/public", { priority: 50 });
        await frontier.add("https://e.com/open", { priority: 1 });
        await flush(); 

        const got: string[] = [];
        for (let i = 0; i < 3; i++) {
            const l = await frontier.claimNext("w");
            if (l) 
                got.push(new URL(l.url).pathname);
            clock.advance(5000); // robots Crawl-delay: 5
        }

        assert.deepEqual(got, ["/private/public", "/open"]);
        assert.equal(frontier.inspectEntry("https://e.com/private/secret")!.state, "failed");
        assert.equal(frontier.inspectHost("e.com")!.crawlDelayMs, 5000);
        healthy(frontier);
    });

    it("holds work back while robots.txt is loading and retries after failure", async () => {
        let calls = 0;
        const flaky: RobotsPolicy = { load: async () => { if (++calls === 1) throw new Error("503"); return parseRobotsTxt("", "TestBot"); } };
        const { frontier, clock } = setup({ robots: flaky, robotsRetryMs: 60_000 });
        await frontier.add("https://e.com/a");
        assert.equal(await frontier.claimNext("w"), null); // still loading
        await flush();
        
        assert.equal(frontier.inspectHost("e.com")!.robotsStatus, "failed");
        assert.equal(await frontier.claimNext("w"), null);
        clock.advance(60_000);
        assert.equal(await frontier.claimNext("w"), null); // triggers the retry
        await flush();
        assert.ok(await frontier.claimNext("w"));
        assert.equal(calls, 2);
    });
});
