import logging

from v1 import common_pb2, semantic_search_pb2, semantic_search_pb2_grpc

import grpc
from ai.search.engines.semantic_search_engine import SemanticSearchEngine
from ai.pipeline.normalizer import normalize_text

logger = logging.getLogger(__name__)

DEFAULT_TOP_K = 10
MAX_TOP_K = 100
MAX_CANDIDATES = 1000
SEARCH_CANDIDATES_PER_RESULT = 10


class SemanticSearchServicer(semantic_search_pb2_grpc.SemanticSearchServiceServicer):
    def __init__(self, engine: SemanticSearchEngine):
        self._engine = engine


    async def Search(
        self,
        request: semantic_search_pb2.SSearchRequest,
        context: grpc.aio.ServicerContext,
    ) -> semantic_search_pb2.SSearchResponse:
        query = request.query.strip()
        if not query or not normalize_text(query):
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
            matches = await self._engine.search(
                query,
                candidate_limit,
                filters,
            )

            hits = [
                common_pb2.SearchHit(
                    document_id=point.payload["document_id"],
                    url=point.payload.get("url", ""),
                    title=point.payload.get("title", ""),
                    snippet=point.payload.get("snippet", ""),
                    score=point.score
                )
                for point in matches
            ]

            results = await self._engine.rerank(query, hits, top_k)

            return semantic_search_pb2.SSearchResponse(
                results=results
            )
        except ValueError as error:
            logger.exception("Semantic search failed")
            await context.abort(grpc.StatusCode.INTERNAL, str(error))