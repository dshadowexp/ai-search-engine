export class LeaseReaper {
    private timer?: NodeJS.Timeout | undefined;

    constructor(
        private readonly frontier: { reapExpiredLeases(): number },
        private readonly intervalMs = 5_000,
    ) {}

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