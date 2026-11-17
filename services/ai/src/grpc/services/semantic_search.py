import asyncio
import logging
from collections.abc import Iterable, Sequence
from math import isfinite
from typing import Protocol

from v1 import common_pb2, semantic_search_pb2, semantic_search_pb2_grpc

import grpc
from src.preprocessing.text_normalizer import preprocess_text
from src.retrieval.similarity import cosine_similarity
from src.retrieval.vector_search import VectorSearch
from src.storage.vector_store import VectorSearchResult

logger = logging.getLogger(__name__)

DEFAULT_TOP_K = 10
MAX_TOP_K = 100
MAX_CANDIDATES = 1000
SEARCH_CANDIDATES_PER_RESULT = 10


class QueryEmbeddingEncoder(Protocol):
    def encode(self, query: str) -> Sequence[float]: ...


class DocumentEmbeddingEncoder(Protocol):
    def encode_documents(self, texts: list[str]) -> Iterable[Iterable[float]]: ...


class SemanticSearchServicer(
    semantic_search_pb2_grpc.SemanticSearchServiceServicer
):
    def __init__(
        self,
        vector_search: VectorSearch,
        query_encoder: QueryEmbeddingEncoder,
        document_encoder: DocumentEmbeddingEncoder,
    ):
        self._vector_search = vector_search
        self._query_encoder = query_encoder
        self._document_encoder = document_encoder

    async def Search(
        self,
        request: semantic_search_pb2.SSearchRequest,
        context: grpc.aio.ServicerContext,
    ) -> semantic_search_pb2.SSearchResponse:
        query = request.query.strip()
        if not query or not preprocess_text(query):
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "query is required")

        top_k = request.top_k or DEFAULT_TOP_K
        if top_k > MAX_TOP_K:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT,
                f"top_k must not exceed {MAX_TOP_K}",
            )

        filters = dict(request.filters)
        if any(not key.strip() for key in filters):
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT,
                "filter keys must not be empty",
            )

        candidate_limit = min(
            MAX_CANDIDATES,
            top_k * SEARCH_CANDIDATES_PER_RESULT,
        )
        try:
            matches = await asyncio.to_thread(
                self._vector_search.search,
                query,
                candidate_limit,
                filters,
            )
        except ValueError as error:
            logger.exception("Semantic search failed")
            await context.abort(grpc.StatusCode.INTERNAL, str(error))

        hits: list[common_pb2.SearchHit] = []
        seen_document_ids: set[str] = set()
        for match in matches:
            if match.chunk.document_id in seen_document_ids:
                continue
            seen_document_ids.add(match.chunk.document_id)
            hits.append(self._to_search_hit(match))
            if len(hits) == top_k:
                break

        return semantic_search_pb2.SSearchResponse(results=hits)

    async def Rerank(
        self,
        request: semantic_search_pb2.RerankRequest,
        context: grpc.aio.ServicerContext,
    ) -> semantic_search_pb2.RerankResponse:
        query = request.query.strip()
        if not query or not preprocess_text(query):
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "query is required")

        candidates = list(request.candidates)
        if len(candidates) > MAX_CANDIDATES:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT,
                f"candidate count must not exceed {MAX_CANDIDATES}",
            )

        top_k = request.top_k or min(DEFAULT_TOP_K, len(candidates))
        if top_k > MAX_TOP_K:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT,
                f"top_k must not exceed {MAX_TOP_K}",
            )
        if not candidates:
            return semantic_search_pb2.RerankResponse()

        try:
            ranked = await asyncio.to_thread(self._rerank, query, candidates)
        except ValueError as error:
            logger.exception("Semantic reranking failed")
            await context.abort(grpc.StatusCode.INTERNAL, str(error))

        return semantic_search_pb2.RerankResponse(
            results=[hit for hit, _ in ranked[:top_k]]
        )

    def _rerank(
        self,
        query: str,
        candidates: list[common_pb2.SearchHit],
    ) -> list[tuple[common_pb2.SearchHit, float]]:
        query_vector = self._query_encoder.encode(query)
        snippets = [
            (index, candidate.snippet)
            for index, candidate in enumerate(candidates)
            if candidate.snippet.strip()
        ]
        scores = [0.0] * len(candidates)

        if snippets:
            embeddings = list(
                self._document_encoder.encode_documents(
                    [snippet for _, snippet in snippets]
                )
            )
            if len(embeddings) != len(snippets):
                raise ValueError("each candidate snippet must have one embedding")
            for (index, _), embedding in zip(snippets, embeddings):
                embedding_vector = tuple(float(value) for value in embedding)
                score = cosine_similarity(query_vector, embedding_vector)
                if not isfinite(score):
                    raise ValueError("rerank scores must be finite")
                scores[index] = score

        ranked: list[tuple[common_pb2.SearchHit, float]] = []
        for candidate, score in zip(candidates, scores):
            hit = common_pb2.SearchHit()
            hit.CopyFrom(candidate)
            hit.score = score
            ranked.append((hit, score))
        return sorted(ranked, key=lambda item: item[1], reverse=True)

    @staticmethod
    def _to_search_hit(match: VectorSearchResult) -> common_pb2.SearchHit:
        metadata = match.chunk.metadata
        return common_pb2.SearchHit(
            document_id=match.chunk.document_id,
            url=SemanticSearchServicer._metadata_text(metadata.get("url")),
            title=SemanticSearchServicer._metadata_text(metadata.get("title")),
            snippet=match.chunk.text,
            score=match.score,
        )

    @staticmethod
    def _metadata_text(value: object) -> str:
        return value if isinstance(value, str) else ""
