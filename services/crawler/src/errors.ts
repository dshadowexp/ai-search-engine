export type FetchErrorKind = "invalid_url" | "blocked" | "timeout" | "network" | "aborted";

export class FetchError extends Error {
    constructor(
        readonly kind: FetchErrorKind,
        message: string,
        /** Whether trying again later could succeed. Blocked/invalid URLs never will. */
        readonly retryable: boolean = kind === "timeout" || kind === "network",
    ) {
        super(message);
        this.name = "FetchError";
    }
}

export class BlockedAddressError extends Error {
    constructor(
        readonly hostname: string,
        readonly address: string,
    ) {
        super(`${hostname} resolves to a non-public address (${address})`);
        this.name = "BlockedAddressError";
    }
}