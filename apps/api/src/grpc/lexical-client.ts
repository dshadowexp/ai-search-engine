import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
    Client,
    credentials,
    type CallOptions,
    type ChannelCredentials,
} from "@grpc/grpc-js";
import {
    LSearchRequestSchema,
    LSearchResponseSchema,
    type LSearchRequest,
    type LSearchResponse,
} from "@search/proto-ts";

const LEXICAL_SEARCH_METHOD = "/search.v1.LexicalSearchService/Search";
const MAX_REQUEST_TIMEOUT_MS = 0x7fff_ffff;

export interface LexicalGrpcClientOptions {
    target: string;
    requestTimeoutMs?: number;
    channelCredentials?: ChannelCredentials;
}

const serializeRequest = (request: LSearchRequest): Buffer =>
    Buffer.from(toBinary(LSearchRequestSchema, request));

const deserializeResponse = (bytes: Buffer): LSearchResponse =>
    fromBinary(LSearchResponseSchema, bytes);

export class LexicalGrpcClient {
    private readonly client: Client;
    private readonly requestTimeoutMs: number;

    constructor(options: LexicalGrpcClientOptions) {
        const target = options.target.trim();
        if (!target) throw new TypeError("Indexer gRPC target must not be empty");

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

    search(query: string, topK = 10): Promise<LSearchResponse> {
        const normalizedQuery = query.trim();
        if (!normalizedQuery) throw new TypeError("query must not be empty");
        if (!Number.isInteger(topK) || topK < 1 || topK > 0xffff_ffff) {
            throw new RangeError("topK must be a positive uint32");
        }

        const request = create(LSearchRequestSchema, {
            query: normalizedQuery,
            topK,
        });
        const callOptions: CallOptions = {
            deadline: Date.now() + this.requestTimeoutMs,
        };

        return new Promise((resolve, reject) => {
            this.client.makeUnaryRequest(
                LEXICAL_SEARCH_METHOD,
                serializeRequest,
                deserializeResponse,
                request,
                callOptions,
                (error, response) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    if (!response) {
                        reject(new Error("Indexer returned an empty lexical search response"));
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
}
