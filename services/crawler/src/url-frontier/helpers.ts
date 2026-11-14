import assert from "node:assert/strict";
import { Frontier, type FrontierConfig } from "./frontier.ts";

/** Frontier with a fake clock: advance time deterministically instead of sleeping. */
export function setup(cfg: FrontierConfig = {}) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => void (t += ms) };
  const frontier = new Frontier({ now: clock.now, defaultCrawlDelayMs: 1000, maxConcurrencyPerHost: 2, ...cfg });
  return { frontier, clock };
}

/** Lets pending promises (e.g. the robots.txt load) settle. */
export const flush = () => new Promise((r) => setImmediate(r));

/** Asserts the frontier's internal invariants hold. */
export const healthy = (f: Frontier) => assert.deepEqual(f.checkInvariants(), []);