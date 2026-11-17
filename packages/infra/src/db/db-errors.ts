import { DbError, InfraError } from "../errors.js";

const NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "EHOSTUNREACH"]);

interface PgLikeError {
  code?: string;
  message?: string;
  constraint?: string;
}

/** SQLSTATEs that mean "run the whole transaction again": serialization failure, deadlock. */
export const isTransactionRetryable = (err: unknown): boolean => err instanceof DbError && (err.code === "40001" || err.code === "40P01");

export const isUniqueViolation = (err: unknown): boolean => err instanceof DbError && err.code === "23505";

/**
 * Pg/driver error -> DbError. Errors that are NOT from the database (a bug in the caller's code) are
 * returned unchanged, so they are never mistaken for infrastructure failures.
 */
export function mapPgError(err: unknown): unknown {
  if (err instanceof InfraError) return err;
  const e = (err ?? {}) as PgLikeError;
  const message = e.message ?? "database error";
  const code = e.code;
  const opts = {
    ...(code !== undefined ? { code } : {}),
    ...(e.constraint !== undefined ? { constraint: e.constraint } : {}),
    cause: err,
  };

  if (code && NETWORK_CODES.has(code)) return new DbError("unavailable", message, opts);
  if (!code || !/^[0-9A-Z]{5}$/.test(code)) {
    if (/timeout exceeded when trying to connect/i.test(message)) return new DbError("timeout", "timed out waiting for a database connection (pool exhausted?)", opts);
    if (/connection terminated|not queryable|connection error|ended unexpectedly|Client was closed/i.test(message)) return new DbError("unavailable", message, opts);
    if (/Cannot use a pool after calling end/i.test(message)) return new DbError("invalid", message, { ...opts, retryable: false });
    return err; // not a database error
  }

  if (code === "40001" || code === "40P01") return new DbError("conflict", message, { ...opts, retryable: true });
  if (code === "23505") return new DbError("conflict", message, { ...opts, retryable: false });
  if (code === "57014") return new DbError("timeout", message, opts); // statement_timeout / cancelled
  if (code.startsWith("08") || code === "57P01" || code === "57P02" || code === "57P03" || code === "53300" || code.startsWith("53")) {
    return new DbError("unavailable", message, opts);
  }
  if (code === "42501" || code.startsWith("28")) return new DbError("forbidden", message, opts);
  return new DbError("invalid", message, { ...opts, retryable: false }); // syntax, integrity, data errors: retrying cannot help
}
