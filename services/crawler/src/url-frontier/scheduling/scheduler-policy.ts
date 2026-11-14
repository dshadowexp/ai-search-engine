import type { HostRecord } from "../types.js";
import type { HostQueue } from "./host-queue.js";

export function nextEligibleAt(host: HostRecord, queue: HostQueue): number | null {
    if (host.robotsStatus === "fetching") return null;
    if (host.inFlight >= host.maxConcurrency) return null;
    const readyAt = queue.earliestReadyAt();
    if (readyAt === null) return null;
    return Math.max(host.nextAllowedAt, readyAt);
}
