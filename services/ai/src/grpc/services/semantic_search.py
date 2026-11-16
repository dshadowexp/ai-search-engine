# from __future__ import annotations

# import grpc

# from ai_service.domain.interfaces import ResultReranker, SemanticRetriever
# from ai.v1 import (
#     common_pb2,
#     semantic_search_pb2,
#     semantic_search_pb2_grpc,
# )


# class SemanticSearchServicer(
#     semantic_search_pb2_grpc.SemanticSearchServiceServicer
# ):
#     def __init__(self, retriever: SemanticRetriever, reranker: ResultReranker):
#         self._retriever = retriever
#         self._reranker = reranker

#     async def Search(self, request, context):
#         query = request.query.strip()
#         if not query:
#             await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "query is required")

#         top_k = max(1, min(request.top_k or 10, 100))
#         hits = await self._retriever.search(
#             query,
#             top_k=top_k,
#             filters=dict(request.filters),
#         )
#         return semantic_search_pb2.SearchResponse(
#             results=[self._to_proto_hit(hit) for hit in hits]
#         )

#     async def Rerank(self, request, context):
#         query = request.query.strip()
#         if not query:
#             await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "query is required")

#         candidates = [self._from_proto_hit(hit) for hit in request.candidates]
#         top_k = max(1, min(request.top_k or len(candidates) or 10, 100))
#         ranked = await self._reranker.rerank(query, candidates, top_k=top_k)
#         return semantic_search_pb2.RerankResponse(
#             results=[self._to_proto_hit(hit) for hit in ranked]
#         )

#     async def SearchStream(self, request, context):
#         response = await self.Search(request, context)
#         for hit in response.results:
#             if not context.cancelled():
#                 yield hit

#     @staticmethod
#     def _to_proto_hit(hit):
#         return common_pb2.SearchHit(
#             document_id=hit.document_id,
#             url=hit.url,
#             title=hit.title,
#             snippet=hit.snippet,
#             score=hit.score,
#         )

#     @staticmethod
#     def _from_proto_hit(hit):
#         from ai_service.domain.interfaces import DomainHit

#         return DomainHit(
#             document_id=hit.document_id,
#             url=hit.url,
#             title=hit.title,
#             snippet=hit.snippet,
#             score=hit.score,
#         )
