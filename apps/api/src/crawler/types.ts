export interface CrawlTask {
    url: string;
    priority: number;
    depth: number;
    attempts: number;
    availableAt: number;
}

export interface HostState {
    host: string;

    // Robots policy
    robots: string;

    // Rate limiting
    nextAllowedAt: number;

    // Concurrency
    activeRequests: number;
    maxConcurrency: number;

    // Scheduling
    queue: CrawlTask[];

    // Retry tracking
    failures: number;
}