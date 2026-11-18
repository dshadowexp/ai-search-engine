import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
    Client,
    credentials,
    type CallOptions,
    type ChannelCredentials,
} from "@grpc/grpc-js";
import {
    SSearchRequestSchema,
    SSearchResponseSchema,
    type SearchHit,
    type SSearchRequest,
    type SSearchResponse,
} from "@search/proto-ts";

const SEMANTIC_SEARCH_METHOD = "/search.v1.SemanticSearchService/Search";
const SEMANTIC_RERANK_METHOD = "/search.v1.SemanticSearchService/Rerank";
const DEFAULT_TOP_K = 10;
const MAX_TOP_K = 100;
const MAX_CANDIDATES = 1000;
const MAX_REQUEST_TIMEOUT_MS = 0x7fff_ffff;

export interface SemanticGrpcClientOptions {
    target: string;
    requestTimeoutMs?: number;
    channelCredentials?: ChannelCredentials;
}

const serializeSearchRequest = (request: SSearchRequest): Buffer =>
    Buffer.from(toBinary(SSearchRequestSchema, request));

const deserializeSearchResponse = (bytes: Buffer): SSearchResponse =>
    fromBinary(SSearchResponseSchema, bytes);


export class SemanticGrpcClient {
    private readonly client: Client;
    private readonly requestTimeoutMs: number;

    constructor(options: SemanticGrpcClientOptions) {
        const target = options.target.trim();
        if (!target) throw new TypeError("Semantic search gRPC target must not be empty");

        this.requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
        if (
            !Number.isInteger(this.requestTimeoutMs) ||
            this.requestTimeoutMs < 1 ||
            this.requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS
        ) {
            throw new RangeError("requestTimeoutMs must be between 1 and 2147483647");
        }

        this.client = new Client(
            target,
            options.channelCredentials ?? credentials.createInsecure(),
        );
    }

    search(
        query: string,
        topK = DEFAULT_TOP_K,
        filters: Readonly<Record<string, string>> = {},
    ): Promise<SSearchResponse> {
        const normalizedQuery = query.trim();
        if (!normalizedQuery) throw new TypeError("query must not be empty");
        this.validateTopK(topK);

        const request = create(SSearchRequestSchema, {
            query: normalizedQuery,
            topK,
            filters: { ...filters },
        });

        return new Promise((resolve, reject) => {
            this.client.makeUnaryRequest(
                SEMANTIC_SEARCH_METHOD,
                serializeSearchRequest,
                deserializeSearchResponse,
                request,
                this.callOptions(),
                (error, response) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    if (!response) {
                        reject(new Error("Semantic search returned an empty response"));
                        return;
                    }
                    resolve(response);
                },
            );
        });
    }

    close(): void {
        this.client.close();
    }

    private validateTopK(topK: number): void {
        if (!Number.isInteger(topK) || topK < 1 || topK > MAX_TOP_K) {
            throw new RangeError(`topK must be between 1 and ${MAX_TOP_K}`);
        }
    }

    private callOptions(): CallOptions {
        return { deadline: Date.now() + this.requestTimeoutMs };
    }
}