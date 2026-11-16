import { InfraError, StaleReceiptError } from "../errors.ts";

interface AwsLikeError {
  name?: string;
  message?: string;
  code?: string;
  $fault?: string;
  $retryable?: unknown;
  $metadata?: { httpStatusCode?: number };
}

const NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "EHOSTUNREACH", "ENETUNREACH"]);
const has = (name: string, ...needles: string[]) => needles.some((n) => name.includes(n));

/** Translates an AWS SDK failure (S3 or SQS) into the shared InfraError vocabulary. */
export function mapAwsError(err: unknown, context: string): InfraError {
    if (err instanceof InfraError) return err;
    const e = (err ?? {}) as AwsLikeError;
    const name = e.name ?? "";
    const status = e.$metadata?.httpStatusCode;
    const message = `${context}: ${e.message || name || "unknown error"}`;
    const cause = err;

    if (name === "AbortError") return new InfraError("aborted", message, { cause });
    if (has(name, "ReceiptHandleIsInvalid", "MessageNotInflight")) return new StaleReceiptError(message, cause);
    if (name === "TimeoutError" || name === "RequestTimeout" || name === "RequestTimeoutException") return new InfraError("timeout", message, { cause });
    if (e.code && NETWORK_CODES.has(e.code)) return new InfraError("unavailable", message, { cause });

    if (has(name, "NoSuchKey", "NoSuchBucket", "NotFound", "NonExistentQueue", "QueueDoesNotExist") || status === 404) {
        return new InfraError("not_found", message, { cause });
    }
    if (name === "ConditionalRequestConflict") return new InfraError("conflict", message, { cause, retryable: true });
    if (name === "PreconditionFailed" || status === 412 || status === 409) return new InfraError("conflict", message, { cause });
    if (has(name, "AccessDenied", "Forbidden", "InvalidAccessKeyId", "SignatureDoesNotMatch", "ExpiredToken", "InvalidClientTokenId") || status === 401 || status === 403) {
        return new InfraError("forbidden", message, { cause });
    }
    if (has(name, "SlowDown", "Throttl", "RequestLimitExceeded", "TooManyRequests") || status === 429) return new InfraError("throttled", message, { cause });
    if (has(name, "ServiceUnavailable", "InternalError", "InternalFailure", "ServiceFailure") || (status !== undefined && status >= 500)) {
        return new InfraError("unavailable", message, { cause });
    }
    if (has(name, "InvalidParameter", "InvalidAttribute", "InvalidMessageContents", "BatchRequestTooLong", "TooManyEntries", "ValidationError", "MalformedXML") || status === 400) {
        return new InfraError("invalid", message, { cause });
    }
    // Unknown: trust the SDK's own hint, otherwise don't retry what we don't understand.
    return e.$retryable || e.$fault === "server" ? new InfraError("unavailable", message, { cause }) : new InfraError("invalid", message, { cause, retryable: false });
}