import { createS3Client } from "../aws/aws-client.ts";
import { mapAwsError } from "../aws/aws-errors.ts";
import { BlobNotFoundError, InfraError, invalid } from "../errors.ts";
import {
    DeleteObjectCommand, 
    GetObjectCommand, 
    HeadObjectCommand, 
    ListObjectsV2Command, 
    PutObjectCommand, 
    S3Client
} from "@aws-sdk/client-s3";

export interface BlobMetadata {
    key: string;
    size: number;
    etag?: string | undefined;
    contentType?: string | undefined;
    /** ms epoch */
    lastModified?: number | undefined;
    /** User metadata. Keys are lowercased and values ASCII-only (an S3 constraint, enforced everywhere). */
    metadata?: Record<string, string> | undefined;
}

export interface PutOptions {
    contentType?: string;
    metadata?: Record<string, string>;
    /**
     * Write only if the key does not exist; an existing key is NOT an error (created: false).
     * The idiom for content-addressed, immutable objects: retrying a write is always safe.
     */
    ifNotExists?: boolean;
    signal?: AbortSignal;
}

export interface PutResult {
    created: boolean;
    etag?: string | undefined;
}

export interface GetOptions {
    /** Refuse (InfraError "invalid") to read objects larger than this. */
    maxBytes?: number;
    signal?: AbortSignal;
}

export interface BlobObject {
    metadata: BlobMetadata;
    body: Uint8Array;
}

export interface ListOptions {
    limit?: number;
    /** Opaque: pass back the previous result's nextToken. */
    token?: string;
    signal?: AbortSignal;
}

export interface ListResult {
    items: BlobMetadata[];
    nextToken?: string | undefined;
}

export interface BlobStore {
    put(key: string, body: Uint8Array | string, options?: PutOptions): Promise<PutResult>;
    /** Throws BlobNotFoundError. */
    get(key: string, options?: GetOptions): Promise<BlobObject>;
    /** undefined when missing. */
    head(key: string, options?: { signal?: AbortSignal }): Promise<BlobMetadata | undefined>;
    /** Idempotent: deleting a missing key succeeds. */
    delete(key: string, options?: { signal?: AbortSignal }): Promise<void>;
    /** Keys in lexicographic order. */
    list(prefix: string, options?: ListOptions): Promise<ListResult>;
    close(): Promise<void>;
}

export function assertValidKey(key: string): void {
    if (typeof key !== "string" || key.length === 0) throw invalid("blob key must be a non-empty string");
    if (new TextEncoder().encode(key).length > 1024) throw invalid("blob key exceeds 1024 bytes");
    if (key.startsWith("/")) throw invalid(`blob key must not start with "/": ${key}`);
    if (/(^|\/)\.\.?(\/|$)/.test(key)) throw invalid(`blob key must not contain "." or ".." segments: ${key}`);
    if (/[\u0000-\u001f\u007f]/.test(key)) throw invalid("blob key must not contain control characters");
}

/** Lowercases keys and rejects non-ASCII values: identical behaviour in memory and on S3. */
export function normalizeMetadata(metadata: Record<string, string> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(metadata ?? {})) {
        if (!/^[\x20-\x7e]*$/.test(v)) throw invalid(`blob metadata "${k}" must be printable ASCII`);
        out[k.toLowerCase()] = v;
    }
    return out;
}

export const toBytes = (body: Uint8Array | string): Uint8Array => (typeof body === "string" ? new TextEncoder().encode(body) : body);

export async function putJson(store: BlobStore, key: string, value: unknown, options: PutOptions = {}): Promise<PutResult> {
    return store.put(key, JSON.stringify(value), { contentType: "application/json", ...options });
}

export async function getJson<T = unknown>(store: BlobStore, key: string, options?: GetOptions): Promise<T> {
    const { body } = await store.get(key, options);
    try {
        return JSON.parse(new TextDecoder().decode(body)) as T;
    } catch (cause) {
        throw new InfraError("invalid", `blob ${key} is not valid JSON`, { cause });
    }
}

const unquote = (etag: string | undefined) => etag?.replace(/^"|"$/g, "");

export interface S3BlobStoreOptions {
    region: string;
    bucket: string;
    /** Prepended to every key; invisible to callers. */
    prefix?: string;
    maxObjectBytes?: number;
    /** Close the SDK client when the store closes. */
    ownsClient?: boolean;
}

export class S3BlobStore implements BlobStore {
    private readonly client: S3Client;
    private readonly bucket: string;
    private readonly prefix: string;
    private readonly maxObjectBytes: number;
    private readonly ownsClient: boolean;

    constructor(opts: S3BlobStoreOptions) {
        this.client = createS3Client({ region: opts.region });
        this.bucket = opts.bucket;
        this.prefix = opts.prefix ?? "";
        this.maxObjectBytes = opts.maxObjectBytes ?? 10 * 1024 * 1024;
        this.ownsClient = opts.ownsClient ?? false;
    }

    async put(key: string, body: Uint8Array | string, options: PutOptions = {}): Promise<PutResult> {
        assertValidKey(key);
        const bytes = toBytes(body);
        if (bytes.byteLength > this.maxObjectBytes) 
            throw new InfraError("invalid", `blob ${key} exceeds ${this.maxObjectBytes} bytes`);

        const metadata = normalizeMetadata(options.metadata);
        try {
            const out = await this.client.send(
                new PutObjectCommand({
                    Bucket: this.bucket,
                    Key: this.prefix + key,
                    Body: bytes,
                    ContentType: options.contentType,
                    Metadata: metadata,
                    // S3 conditional write: "create only if absent". Atomic on the server, no race with another writer.
                    ...(options.ifNotExists ? { IfNoneMatch: "*" } : {}),
                }),
                { ...(options.signal ? { abortSignal: options.signal } : {}) },
            );
            return { created: true, etag: unquote(out.ETag) };
        } catch (err) {
            const mapped = mapAwsError(err, `put ${key}`);
            if (options.ifNotExists && mapped.kind === "conflict" && !mapped.retryable) return { created: false }; // it already exists: fine
            throw mapped;
        }
    }

    async get(key: string, options: GetOptions = {}): Promise<BlobObject> {
        assertValidKey(key);
        try {
            const out = await this.client.send(
                new GetObjectCommand({ Bucket: this.bucket, Key: this.prefix + key }),
                { ...(options.signal ? { abortSignal: options.signal } : {}) },
            );
            const size: number = out.ContentLength ?? 0;
            if (options.maxBytes !== undefined && size > options.maxBytes) {
                await out.Body?.transformToWebStream().cancel(); // don't download what we are going to refuse
                throw new InfraError("invalid", `blob ${key} is ${size} bytes, over the ${options.maxBytes} byte limit`);
            }
            const body: Uint8Array = out.Body ? await out.Body.transformToByteArray() : new Uint8Array();
            return {
                body,
                metadata: {
                    key,
                    size: body.byteLength,
                    etag: unquote(out.ETag),
                    contentType: out.ContentType,
                    lastModified: out.LastModified?.getTime(),
                    metadata: out.Metadata ?? {},
                },
            };
        } catch (err) {
            const mapped = mapAwsError(err, `get ${key}`);
            throw mapped.kind === "not_found" ? new BlobNotFoundError(key, err) : mapped;
        }
    }

    async head(key: string, options: { signal?: AbortSignal } = {}): Promise<BlobMetadata | undefined> {
        assertValidKey(key);
        try {
            const out = await this.client.send(
                new HeadObjectCommand({ 
                    Bucket: this.bucket, 
                    Key: this.prefix + key 
                }), 
                options.signal ? { abortSignal: options.signal } : {}
            );
            return {
                key,
                size: out.ContentLength ?? 0,
                etag: unquote(out.ETag),
                contentType: out.ContentType,
                lastModified: out.LastModified?.getTime(),
                metadata: out.Metadata ?? {},
            };
        } catch (err) {
            const mapped = mapAwsError(err, `head ${key}`);
            if (mapped.kind === "not_found") return undefined;
            throw mapped;
        }
    }

    async delete(key: string, options: { signal?: AbortSignal } = {}): Promise<void> {
        assertValidKey(key);
        try {
            await this.client.send(
                new DeleteObjectCommand({ 
                    Bucket: this.bucket, 
                    Key: this.prefix + key 
                }), 
                options.signal ? { abortSignal: options.signal } : {}
            );
        } catch (err) {
            const mapped = mapAwsError(err, `delete ${key}`);
            if (mapped.kind !== "not_found") throw mapped;
        }
    }

    async list(prefix: string, options: ListOptions = {}): Promise<ListResult> {
        try {
            const out = await this.client.send(
                new ListObjectsV2Command({
                    Bucket: this.bucket,
                    Prefix: this.prefix + prefix,
                    MaxKeys: Math.min(Math.max(options.limit ?? 1000, 1), 1000),
                    ContinuationToken: options.token,
                }),
                options.signal ? { abortSignal: options.signal } : {},
            );
            const items: BlobMetadata[] = (out.Contents ?? []).map((o) => ({
                key: o.Key ? o.Key.slice(this.prefix.length) : "",
                size: o.Size ?? 0,
                etag: unquote(o.ETag),
                lastModified: o.LastModified?.getTime(),
            }));
            return { items, nextToken: out.IsTruncated ? out.NextContinuationToken : undefined };
        } catch (err) {
            throw mapAwsError(err, `list ${prefix}`);
        }
    }

    async close(): Promise<void> {
        if (this.ownsClient) this.client.destroy?.();
    }
}

