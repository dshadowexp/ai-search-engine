from collections.abc import Iterable
from typing import Protocol

from ..preprocessing.text_normalizer import preprocess_text


class QueryEmbeddingModel(Protocol):
    def encode_query(self, query: str) -> Iterable[float]: 
        ...


class QueryEncoder:
    def __init__(self, model: QueryEmbeddingModel | None = None):
        if model is None:
            from ..embeddings.model import EmbeddingModel

            model = EmbeddingModel()
        self.model = model

    def encode(self, query: str) -> list[float]:
        query = preprocess_text(query)
        if not query:
            raise ValueError("query must not be empty")
        return [float(value) for value in self.model.encode_query(query)]