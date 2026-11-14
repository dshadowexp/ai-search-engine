export class LeaseReaper {
    private timer?: NodeJS.Timeout | undefined;
    private readonly frontier: { reapExpiredLeases(): number };
    private readonly intervalMs: number;

    constructor(
        frontier: { reapExpiredLeases(): number },
        intervalMs = 5_000,
    ) {
        this.frontier = frontier;
        this.intervalMs = intervalMs;
    }

    start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => this.frontier.reapExpiredLeases(), this.intervalMs);
        this.timer.unref();
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
    }
}