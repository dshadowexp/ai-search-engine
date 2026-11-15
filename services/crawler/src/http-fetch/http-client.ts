import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { ReadableStream } from "node:stream/web";
import { Agent, fetch as undiciFetch } from "undici";
import { isPublicIp } from "@search/core";
import type { HttpResponse, ResponseHead } from "../types.ts";
import { BlockedAddressError, FetchError } from "../errors.ts";

export interface NetworkPolicy {
    /** hostname -> addresses. Default: the system resolver. */
    resolve?: (hostname: string) => Promise<string[]>;
    /** Default: isPublicIp. A hostname is refused if ANY of its addresses fails this. */
    isAddressAllowed?: (ip: string) => boolean;
}

export interface HttpClientConfig {
    userAgent: string;
    timeoutMs: number;
    maxResponseBytes: number;
    network?: NetworkPolicy;
}

export interface FetchOptions {
    signal?: AbortSignal;
    /** Called with the head before the body is read; return false to skip downloading it. */
    acceptBody?: (head: ResponseHead) => boolean;
}

export interface HttpClient {
    /** One request, no redirects. Throws FetchError for network-level failures; HTTP statuses are returned. */
    fetch(url: string, options?: FetchOptions): Promise<HttpResponse>;
    /**
     * An SSRF-safe fetch with the same connection rules, for components that make their own
     * requests (robots.txt loading). Redirects are the caller's responsibility.
     */
    readonly fetchImpl: typeof fetch;
    close(): Promise<void>;
}

type LookupCallback = (err: Error | null, address?: string | { address: string; family: number }[], family?: number) => void;

/**
 * The SSRF boundary. Node calls this when it is about to open a socket, and connects to
 * exactly the addresses we return, so validation and connection cannot disagree
 * (this is what defeats DNS rebinding). One non-public address rejects the whole hostname.
 */
function createSafeLookup(resolve: (h: string) => Promise<string[]>, allowed: (ip: string) => boolean) {
    return (hostname: string, options: { all?: boolean }, callback: LookupCallback): void => {
        resolve(hostname).then(
            (addresses) => {
                if (addresses.length === 0) 
                    return callback(new Error(`ENOTFOUND ${hostname}`));
                
                const bad = addresses.find((a) => !allowed(a));
                if (bad) 
                    return callback(new BlockedAddressError(hostname, bad));
                
                if (options?.all) 
                    callback(null, addresses.map((address) => ({ address, family: isIP(address) })));
                else 
                    callback(null, addresses[0], isIP(addresses[0]!));
            },
            (err: Error) => callback(err),
        );
    };
}


export class UndiciHttpClient implements HttpClient {
    readonly fetchImpl: typeof fetch;
    private readonly agent: Agent;
    private readonly allowed: (ip: string) => boolean;
    private readonly headers: Record<string, string>;
    private readonly cfg: HttpClientConfig;

    constructor(cfg: HttpClientConfig) {
        this.cfg = cfg;
        const resolve = cfg.network?.resolve ?? (async (host: string) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address));
        
        this.allowed = cfg.network?.isAddressAllowed ?? isPublicIp;
        this.agent = new Agent({
            connect: { lookup: createSafeLookup(resolve, this.allowed) as never, timeout: Math.min(cfg.timeoutMs, 10_000) },
            keepAliveTimeout: 10_000,
        });
        
        this.headers = {
            "user-agent": cfg.userAgent,
            accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        };

        this.fetchImpl = ((input: string | URL, init?: RequestInit) =>
            undiciFetch(input as string, { ...(init as object), dispatcher: this.agent })) as unknown as typeof fetch;
    }

    async fetch(url: string, options: FetchOptions = {}): Promise<HttpResponse> {
        const target = this.parse(url);
        const timeout = AbortSignal.timeout(this.cfg.timeoutMs); // covers headers AND body streaming
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        const started = Date.now();

        try {
            const res = await undiciFetch(target.href, { method: "GET", redirect: "manual", headers: this.headers, dispatcher: this.agent, signal });
            const head: ResponseHead = {
                statusCode: res.status,
                headers: res.headers as unknown as Headers,
                contentType: res.headers.get("content-type"),
            };
            const isRedirect = res.status >= 300 && res.status < 400;
            if (isRedirect || (options.acceptBody && !options.acceptBody(head))) {
                await res.body?.cancel().catch(() => undefined);
                return { ...head, url: target.href, body: new Uint8Array(0), truncated: false, bodySkipped: true, durationMs: Date.now() - started };
            }

            const { bytes, truncated } = await readBounded(res.body as ReadableStream<Uint8Array> | null, this.cfg.maxResponseBytes);
            return { ...head, url: target.href, body: bytes, truncated, bodySkipped: false, durationMs: Date.now() - started };
        } catch (err) {
            throw this.toFetchError(err, options.signal, timeout);
        }
    }

    async close(): Promise<void> {
        await this.agent.close();
    }

    private parse(url: string): URL {
        let u: URL;
        try {
            u = new URL(url);
        } catch {
            throw new FetchError("invalid_url", `invalid URL: ${url}`, false);
        }

        if (u.protocol !== "http:" && u.protocol !== "https:") throw new FetchError("invalid_url", `unsupported protocol: ${u.protocol}`, false);
        // IP literals skip DNS entirely, so the lookup hook never sees them.
        const host = u.hostname.replace(/^\[|\]$/g, "");
        if (isIP(host) && !this.allowed(host)) 
            throw new FetchError("blocked", new BlockedAddressError(host, host).message, false);
        
        return u;
    }

    private toFetchError(err: unknown, caller: AbortSignal | undefined, timeout: AbortSignal): FetchError {
        if (err instanceof FetchError) return err;
        if (caller?.aborted) return new FetchError("aborted", "request aborted", false);
        if (timeout.aborted) return new FetchError("timeout", `timed out after ${this.cfg.timeoutMs}ms`, true);
        
        for (let e: unknown = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
            if (e instanceof BlockedAddressError) return new FetchError("blocked", e.message, false);
        }

        const cause = err instanceof Error && err.cause instanceof Error ? err.cause : undefined;
        const code = (cause as NodeJS.ErrnoException | undefined)?.code;
        return new FetchError("network", `${cause?.message ?? (err as Error)?.message ?? "network error"}${code ? ` (${code})` : ""}`, true);
    }
}

    /** Reads at most `max` bytes (post-decompression), then cancels the stream. */
async function readBounded(body: ReadableStream<Uint8Array> | null, max: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
    if (!body) return { bytes: new Uint8Array(0), truncated: false };
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (total + value.byteLength > max) {
        chunks.push(value.subarray(0, max - total));
        total = max;
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
        }
        chunks.push(value);
        total += value.byteLength;
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.byteLength;
    }
    return { bytes, truncated };
}
