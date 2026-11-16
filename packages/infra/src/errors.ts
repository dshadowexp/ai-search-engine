export type InfraErrorKind = "not_found" | "conflict" | "invalid" | "forbidden" | "throttled" | "unavailable" | "timeout" | "aborted";

const RETRYABLE_BY_DEFAULT: ReadonlySet<InfraErrorKind> = new Set(["throttled", "unavailable", "timeout"]);

export class InfraError extends Error {
    readonly retryable: boolean;
    readonly kind: InfraErrorKind;

    constructor(kind: InfraErrorKind, message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
        super(message, { cause: options.cause });
        this.name = "InfraError";
        this.kind = kind;
        this.retryable = options.retryable ?? RETRYABLE_BY_DEFAULT.has(kind);
    }
}

export class BlobNotFoundError extends InfraError {
    readonly key: string;

    constructor(key: string, cause?: unknown) {
        super("not_found", `blob not found: ${key}`, { cause });
        this.name = "BlobNotFoundError";
        this.key = key;
    }
}

/** The receipt no longer identifies the caller's delivery (visibility expired and someone else received it). */
export class StaleReceiptError extends InfraError {
    constructor(message = "stale receipt: the message is no longer held by this receiver", cause?: unknown) {
        super("conflict", message, { retryable: false, cause });
        this.name = "StaleReceiptError";
    }
}

export const invalid = (message: string) => new InfraError("invalid", message);