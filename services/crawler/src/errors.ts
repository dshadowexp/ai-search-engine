export type FetchErrorKind = "invalid_url" | "blocked" | "timeout" | "network" | "aborted";

export class FetchError extends Error {
    readonly kind: FetchErrorKind;
    readonly retryable: boolean;

    constructor(
        kind: FetchErrorKind,
        message: string,
        /** Whether trying again later could succeed. Blocked/invalid URLs never will. */
        retryable: boolean,
    ) {
        super(message);
        this.name = "FetchError";
        this.kind = kind;
        this.retryable = retryable || kind === "timeout" || kind === "network";
    }
}

export class BlockedAddressError extends Error {
    readonly hostname: string;
    readonly address: string;

    constructor(
        hostname: string,
        address: string
    ) {
        super(`${hostname} resolves to a non-public address (${address})`);
        this.name = "BlockedAddressError";
        this.hostname = hostname;
        this.address = address;
    }
}