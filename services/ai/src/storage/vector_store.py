from collections.abc import Sequence
from dataclasses import dataclass
from math import isfinite
from typing import Protocol

from preprocessing.chunker import DocumentChunk
from retrieval.similarity import cosine_similarity


@dataclass(frozen=True)
class VectorSearchResult:
    chunk: DocumentChunk
    score: float


class VectorRepository(Protocol):
    def upsert(self, chunks: Sequence[DocumentChunk], embeddings: Sequence[Sequence[float]]) -> None: ...

    def search(self, query_vector: Sequence[float], limit: int) -> list[VectorSearchResult]: ...

    def delete_document(self, document_id: str) -> None: ...


class InMemoryVectorRepository(VectorRepository):
    def __init__(self):
        self._vectors: dict[str, tuple[DocumentChunk, tuple[float, ...]]] = {}
        self._dimension: int | None = None

    def upsert(self, chunks: Sequence[DocumentChunk], embeddings: Sequence[Sequence[float]]) -> None:
        if len(chunks) != len(embeddings):
            raise ValueError("each chunk must have exactly one embedding")

        prepared: dict[str, tuple[DocumentChunk, tuple[float, ...]]] = {}
        dimension = self._dimension
        for chunk, embedding in zip(chunks, embeddings):
            vector = tuple(float(value) for value in embedding)
            if not vector:
                raise ValueError("embeddings must not be empty")
            if not all(isfinite(value) for value in vector):
                raise ValueError("embeddings must contain only finite values")
            if dimension is not None and len(vector) != dimension:
                raise ValueError("all embeddings must have the same dimensions")
            dimension = len(vector)
            prepared[chunk.chunk_id] = (chunk, vector)

        self._vectors.update(prepared)
        self._dimension = dimension

    def search(self, query_vector: Sequence[float], limit: int) -> list[VectorSearchResult]:
        if limit < 1:
            raise ValueError("limit must be positive")
        query = tuple(float(value) for value in query_vector)
        if not query:
            raise ValueError("query vector must not be empty")
        if not all(isfinite(value) for value in query):
            raise ValueError("query vector must contain only finite values")

        matches = [
            VectorSearchResult(chunk, cosine_similarity(query, embedding))
            for chunk, embedding in self._vectors.values()
        ]
        return sorted(matches, key=lambda match: match.score, reverse=True)[:limit]

    def delete_document(self, document_id: str) -> None:
        self._vectors = {
            chunk_id: value
            for chunk_id, value in self._vectors.items()
            if value[0].document_id != document_id
        }
        if not self._vectors:
            self._dimension = None