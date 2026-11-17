import unittest

from v1 import common_pb2, semantic_search_pb2, semantic_search_pb2_grpc

import grpc
from src.grpc.server import GrpcServer
from src.grpc.services.semantic_search import SemanticSearchServicer
from src.preprocessing.chunker import DocumentChunk
from src.retrieval.query_encoder import QueryEncoder
from src.retrieval.vector_search import VectorSearch
from src.storage.vector_store import InMemoryVectorRepository


class FakeEmbeddingModel:
    def encode_query(self, query: str) -> list[float]:
        self.encoded_query = query
        return [1.0, 0.0]

    def encode_documents(self, texts: list[str]) -> list[list[float]]:
        return [
            [1.0, 0.0] if "relevant" in text else [0.0, 1.0]
            for text in texts
        ]


class SemanticSearchTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        model = FakeEmbeddingModel()
        query_encoder = QueryEncoder(model)
        repository = InMemoryVectorRepository()
        repository.upsert(
            [
                DocumentChunk(
                    "doc-1",
                    "chunk-1",
                    "relevant first passage",
                    0,
                    {
                        "category": "guide",
                        "url": "https://example.test/1",
                        "title": "Guide",
                    },
                ),
                DocumentChunk(
                    "doc-1",
                    "chunk-2",
                    "another passage",
                    1,
                    {
                        "category": "guide",
                        "url": "https://example.test/1",
                        "title": "Guide",
                    },
                ),
                DocumentChunk(
                    "doc-2",
                    "chunk-3",
                    "other passage",
                    0,
                    {"category": "news"},
                ),
            ],
            [[1.0, 0.0], [0.9, 0.1], [0.0, 1.0]],
        )
        service = SemanticSearchServicer(
            VectorSearch(query_encoder, repository),
            query_encoder,
            model,
        )
        self.server = GrpcServer("127.0.0.1:0")
        self.server.add_semantic_search_service(service)
        await self.server.start()
        self.channel = grpc.aio.insecure_channel(
            f"127.0.0.1:{self.server.bound_port}"
        )
        self.client = semantic_search_pb2_grpc.SemanticSearchServiceStub(self.channel)

    async def asyncTearDown(self) -> None:
        await self.channel.close()
        await self.server.stop()

    async def test_search_filters_and_deduplicates_documents(self) -> None:
        response = await self.client.Search(
            semantic_search_pb2.SSearchRequest(
                query="relevant",
                top_k=2,
                filters={"category": "guide"},
            )
        )

        self.assertEqual(len(response.results), 1)
        self.assertEqual(response.results[0].document_id, "doc-1")
        self.assertEqual(response.results[0].url, "https://example.test/1")
        self.assertEqual(response.results[0].title, "Guide")
        self.assertEqual(response.results[0].snippet, "relevant first passage")

    async def test_search_rejects_empty_queries(self) -> None:
        with self.assertRaises(grpc.aio.AioRpcError) as error:
            await self.client.Search(semantic_search_pb2.SSearchRequest(query="   "))

        self.assertEqual(error.exception.code(), grpc.StatusCode.INVALID_ARGUMENT)

    async def test_rerank_returns_candidates_in_relevance_order(self) -> None:
        response = await self.client.Rerank(
            semantic_search_pb2.RerankRequest(
                query="relevant",
                top_k=2,
                candidates=[
                    common_pb2.SearchHit(
                        document_id="doc-2",
                        snippet="unrelated passage",
                        score=0.9,
                    ),
                    common_pb2.SearchHit(
                        document_id="doc-1",
                        url="https://example.test/1",
                        snippet="relevant passage",
                        score=0.1,
                    ),
                ],
            )
        )

        self.assertEqual(
            [hit.document_id for hit in response.results],
            ["doc-1", "doc-2"],
        )
        self.assertAlmostEqual(response.results[0].score, 1.0)
        self.assertEqual(response.results[0].url, "https://example.test/1")
