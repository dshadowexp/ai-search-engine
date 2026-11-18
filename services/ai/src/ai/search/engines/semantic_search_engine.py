import asyncio
from ai.search.retriever import QdrantRetriever
from ai.embeddings.embedder import Embedder
from ai.search.reranker import Reranker


class SemanticSearchEngine:
    def __init__(
            self, 
            embedder: Embedder,
            vector_store: QdrantRetriever,
            reranker: Reranker
    ):
        self._embedder = embedder
        self._vector_store = vector_store
        self._reranker = reranker

        # Prevent concurrent inference on the same model instance.
        self.lock = asyncio.Lock()


    async def search(self, query: str, top_k: int, filters: dict[str, str]):
        query_vector = self._embedder.encode_query(query)
        candidate_limit = min(top_k * 5, 100)

        points = await self._vector_store.search(
            vector=query_vector.tolist(),
            top_k=candidate_limit,
            filters=filters
        )

        seen_document_ids, candidates = set(), []
        for point in points:
            payload = point.payload or {}
            document_id = payload.get("document_id")
            if not isinstance(document_id, str) or document_id in seen_document_ids:
                continue

            seen_document_ids.add(document_id)
            candidates.append(point)

        return candidates
        

    async def rerank(
            self, 
            query: str, 
            candidates, 
            top_k: int
        ):
        if not candidates:
            return []

        # query_vector = self._embedder.encode_query(query)

        # Construct query-document pairs.
        pairs = [
            (
                query,
                f"{candidate.title}\n{candidate.snippet}"
            )
            for candidate in candidates
            if candidate.snippet.strip()
        ]

        # Run synchronous model inference outside the event loop.
        async with self.lock:
            scores = await asyncio.to_thread(
                self._reranker.predict,
                pairs
            )

        # Associate scores with their original candidates.
        ranked = sorted(
            zip(candidates, scores),
            key=lambda item: float(item[1]),
            reverse=True
        )

        results = []

        for candidate, score in ranked[:top_k]:
            hit = type(candidate)()
            hit.CopyFrom(candidate)
            hit.score = float(score)
            results.append(hit)

        return results
