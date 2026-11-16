from collections.abc import Sequence
from typing import Protocol

from storage.vector_store import VectorRepository, VectorSearchResult


class QueryVectorEncoder(Protocol):
    def encode(self, query: str) -> Sequence[float]: ...


class VectorSearch:
    def __init__(self, encoder: QueryVectorEncoder, repository: VectorRepository):
        self.encoder = encoder
        self.repository = repository

    def search(self, query: str, limit: int = 10) -> list[VectorSearchResult]:
        if not query.strip():
            raise ValueError("query must not be empty")
        if limit < 1:
            raise ValueError("limit must be positive")
        return self.repository.search(self.encoder.encode(query), limit)