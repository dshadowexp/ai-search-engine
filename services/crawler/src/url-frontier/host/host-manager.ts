import type { RobotsRules } from "../policies/robots-policy.ts";
import type { FrontierEntry, HostRecord } from "../types.ts";
import { HostQueue } from "../scheduling/host-queue.ts";

interface HostDefaults {
    maxConcurrency: number;
    crawlDelayMs: number;
    maxCrawlDelayMs: number;
    robotsEnabled: boolean;
}

export class HostManager {
    private readonly hosts = new Map<string, HostRecord>();
    private readonly queues = new Map<string, HostQueue>();
    private readonly rules = new Map<string, RobotsRules>();

    constructor(
        private readonly defaults: HostDefaults,
        private readonly onPromote: (entry: FrontierEntry) => void,
    ) {}

    get size(): number {
        return this.hosts.size;
    }

    /**
     * Retrieve a host record
     * 
     * @param hostId 
     * @returns 
     */
    get(hostId: string): HostRecord | undefined {
        return this.hosts.get(hostId);
    }

    /**
     * Retrieve the queue of a host
     * 
     * @param hostId 
     * @returns 
     */
    queue(hostId: string): HostQueue | undefined {
        return this.queues.get(hostId);
    }

    all(): IterableIterator<HostRecord> {
        return this.hosts.values();
    }

    /**
     * Gets or creates an existing host record and queue; 
     * Specifies if newly created with the created property
     * 
     * @param url 
     * @returns 
     */
    getOrCreate(url: URL): { host: HostRecord; queue: HostQueue; created: boolean } {
        const id = url.host;
        const existing = this.hosts.get(id);
        if (existing) 
            return { host: existing, queue: this.queues.get(id)!, created: false };

        const host: HostRecord = {
            id,
            origin: url.origin,
            pendingCount: 0,
            inFlight: 0,
            maxConcurrency: this.defaults.maxConcurrency,
            crawlDelayMs: this.defaults.crawlDelayMs,
            nextAllowedAt: 0,
            robotsStatus: this.defaults.robotsEnabled ? "unknown" : "ready",
        };
        const queue = new HostQueue(this.onPromote);
        this.hosts.set(id, host);
        this.queues.set(id, queue);
        return { host, queue, created: true };
    }

    /**
     * Sets the robot rules of a host
     * 
     * @param host 
     * @param rules 
     */
    setRobots(host: HostRecord, rules: RobotsRules): void {
        this.rules.set(host.id, rules);
        host.robotsStatus = "ready";
        if (rules.crawlDelayMs !== undefined) {
            host.crawlDelayMs = Math.min(
                Math.max(this.defaults.crawlDelayMs, rules.crawlDelayMs), 
                this.defaults.maxCrawlDelayMs
            );
        }
    }

    /**
     * Checks if a host is allowed to be crawled
     * 
     * @param hostId 
     * @param url 
     * @returns 
     */
    isAllowed(hostId: string, url: string): boolean {
        const r = this.rules.get(hostId);
        return r ? r.isAllowed(url) : true;
    }
}