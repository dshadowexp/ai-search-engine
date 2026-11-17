import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
    status,
    type handleUnaryCall,
    type ServiceDefinition,
    type UntypedServiceImplementation,
} from "@grpc/grpc-js";
import {
    LSearchRequestSchema,
    LSearchResponseSchema,
    SearchHitSchema,
    type LSearchRequest,
    type LSearchResponse,
} from "@search/proto-ts";
import { LogStream } from "@search/infra";
import type { LexicalSearchService } from "../search/search-service.ts";

const serializeRequest = (request: LSearchRequest): Buffer =>
    Buffer.from(toBinary(LSearchRequestSchema, request));

const deserializeRequest = (bytes: Buffer): LSearchRequest =>
    fromBinary(LSearchRequestSchema, bytes);

const serializeResponse = (response: LSearchResponse): Buffer =>
    Buffer.from(toBinary(LSearchResponseSchema, response));

const deserializeResponse = (bytes: Buffer): LSearchResponse =>
    fromBinary(LSearchResponseSchema, bytes);

export const lexicalSearchServiceDefinition: ServiceDefinition = {
    search: {
        path: "/search.v1.LexicalSearchService/Search",
        requestStream: false,
        responseStream: false,
        requestSerialize: serializeRequest,
        requestDeserialize: deserializeRequest,
        responseSerialize: serializeResponse,
        responseDeserialize: deserializeResponse,
        originalName: "Search",
    },
};

export function createLexicalSearchHandler(
    searchService: Pick<LexicalSearchService, "search">,
): handleUnaryCall<LSearchRequest, LSearchResponse> {
    return (call, callback) => {
        const query = call.request.query.trim();
        if (!query) {
            callback({
                code: status.INVALID_ARGUMENT,
                details: "query is required",
            });
            return;
        }

        const options = call.request.topK > 0 ? { limit: call.request.topK } : {};
        void searchService.search(query, options).then(({ hits }) =>
            create(LSearchResponseSchema, {
                    results: hits.map((hit) => create(SearchHitSchema, {
                        documentId: hit.documentId,
                        url: hit.url,
                        title: hit.title,
                        snippet: hit.snippet,
                        score: hit.score,
                    })),
            }),
        ).then(
            (response) => callback(null, response),
            (error: unknown) => {
                LogStream.getInstance().log(
                    { error: error instanceof Error ? error.message : String(error) },
                    "Lexical search failed",
                    true,
                );
                callback({
                    code: status.INTERNAL,
                    details: "Lexical search failed",
                });
            },
        );
    };
}

export const lexicalSearchServiceImplementation = (
    searchService: Pick<LexicalSearchService, "search">,
): UntypedServiceImplementation => ({
    search: createLexicalSearchHandler(searchService),
});
