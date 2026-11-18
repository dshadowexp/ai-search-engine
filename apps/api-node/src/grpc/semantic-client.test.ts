import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
    Server,
    ServerCredentials,
    type ServiceDefinition,
    type ServerUnaryCall,
    type sendUnaryData,
} from "@grpc/grpc-js";
import {
    RerankRequestSchema,
    RerankResponseSchema,
    SearchHitSchema,
    SSearchRequestSchema,
    SSearchResponseSchema,
    type RerankRequest,
    type RerankResponse,
    type SSearchRequest,
    type SSearchResponse,
    type SearchHit,
} from "@search/proto-ts";
import { SemanticGrpcClient } from "./semantic-client.ts";

const serviceDefinition: ServiceDefinition = {
    Search: {
        path: "/search.v1.SemanticSearchService/Search",
        requestStream: false,
        responseStream: false,
        requestSerialize: (request: SSearchRequest) =>
            Buffer.from(toBinary(SSearchRequestSchema, request)),
        requestDeserialize: (bytes: Buffer) => fromBinary(SSearchRequestSchema, bytes),
        responseSerialize: (response: SSearchResponse) =>
            Buffer.from(toBinary(SSearchResponseSchema, response)),
        responseDeserialize: (bytes: Buffer) => fromBinary(SSearchResponseSchema, bytes),
    },
    Rerank: {
        path: "/search.v1.SemanticSearchService/Rerank",
        requestStream: false,
        responseStream: false,
        requestSerialize: (request: RerankRequest) =>
            Buffer.from(toBinary(RerankRequestSchema, request)),
        requestDeserialize: (bytes: Buffer) => fromBinary(RerankRequestSchema, bytes),
        responseSerialize: (response: RerankResponse) =>
            Buffer.from(toBinary(RerankResponseSchema, response)),
        responseDeserialize: (bytes: Buffer) => fromBinary(RerankResponseSchema, bytes),
    },
};

describe("SemanticGrpcClient", () => {
    const server = new Server();
    let client: SemanticGrpcClient;
    let searchRequest: SSearchRequest | undefined;
    let rerankRequest: RerankRequest | undefined;

    const searchHandler = (
        call: ServerUnaryCall<SSearchRequest, SSearchResponse>,
        callback: sendUnaryData<SSearchResponse>,
    ): void => {
        searchRequest = call.request;
        callback(null, create(SSearchResponseSchema, {
            results: [
                create(SearchHitSchema, {
                    documentId: "doc-1",
                    url: "https://example.test/1",
                    title: "Guide",
                    snippet: "Relevant result",
                    score: 0.95,
                }),
            ],
        }));
    };

    const rerankHandler = (
        call: ServerUnaryCall<RerankRequest, RerankResponse>,
        callback: sendUnaryData<RerankResponse>,
    ): void => {
        rerankRequest = call.request;
        callback(null, create(RerankResponseSchema, {
            results: [
                create(SearchHitSchema, {
                    documentId: "doc-2",
                    snippet: "Best candidate",
                    score: 0.99,
                }),
            ],
        }));
    };

    before(async () => {
        server.addService(serviceDefinition, {
            Search: searchHandler,
            Rerank: rerankHandler,
        });
        const port = await new Promise<number>((resolve, reject) => {
            server.bindAsync(
                "127.0.0.1:0",
                ServerCredentials.createInsecure(),
                (error, boundPort) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve(boundPort);
                },
            );
        });
        client = new SemanticGrpcClient({ target: `127.0.0.1:${port}` });
    });

    after(async () => {
        client.close();
        await new Promise<void>((resolve, reject) => {
            server.tryShutdown((error) => {
                if (error) reject(error);
                else resolve();
            });
        });
    });

    it("sends semantic search requests and decodes results", async () => {
        const response = await client.search("  travel guide ", 5, { locale: "en" });

        assert.equal(searchRequest?.query, "travel guide");
        assert.equal(searchRequest?.topK, 5);
        assert.deepEqual(searchRequest?.filters, { locale: "en" });
        assert.equal(response.results[0]?.documentId, "doc-1");
        assert.ok(Math.abs((response.results[0]?.score ?? 0) - 0.95) < 1e-6);
    });

    it("sends rerank candidates and decodes ranked hits", async () => {
        const candidates: SearchHit[] = [
            create(SearchHitSchema, {
                documentId: "doc-1",
                snippet: "Candidate",
                score: 0.5,
            }),
        ];
        const response = await client.rerank("travel guide", candidates, 1);

        assert.equal(rerankRequest?.query, "travel guide");
        assert.equal(rerankRequest?.topK, 1);
        assert.equal(rerankRequest?.candidates[0]?.documentId, "doc-1");
        assert.equal(response.results[0]?.documentId, "doc-2");
        assert.ok(Math.abs((response.results[0]?.score ?? 0) - 0.99) < 1e-6);
    });

    it("rejects invalid queries and result counts before making an RPC", () => {
        assert.throws(() => client.search("  "), /query must not be empty/);
        assert.throws(() => client.search("valid", 101), /topK must be between/);
        assert.throws(() => client.rerank("valid", [], 0), /topK must be between/);
    });
});
