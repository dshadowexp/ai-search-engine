/** Resolves after `ms`, or immediately when `signal` aborts. Never rejects. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted) return resolve();
            const onAbort = () => {
            clearTimeout(timer);
            resolve();
        };

        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}