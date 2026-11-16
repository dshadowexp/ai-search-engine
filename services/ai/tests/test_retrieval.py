import pytest

from src.preprocessing.chunker import DocumentChunk
from src.retrieval.query_encoder import QueryEncoder
from src.retrieval.similarity import cosine_similarity
from src.retrieval.vector_search import VectorSearch
from src.storage.vector_store import InMemoryVectorRepository


class FakeEmbeddingModel:
    def __init__(self, vector):
        self.vector = vector
        self.query = None

    def encode_query(self, query):
        self.query = query
        return self.vector


def test_query_encoder_preprocesses_before_encoding():
    model = FakeEmbeddingModel([0.25, 0.75])

    vector = QueryEncoder(model).encode("  Caf\u0065\u0301\tguide  ")

    assert vector == [0.25, 0.75]
    assert model.query == "Café guide"


def test_vector_search_returns_nearest_chunk_first():
    repository = InMemoryVectorRepository()
    chunks = [
        DocumentChunk("doc-1", "chunk-1", "nearest", 0),
        DocumentChunk("doc-2", "chunk-2", "farther", 0),
    ]
    repository.upsert(chunks, [[1.0, 0.0], [0.0, 1.0]])
    search = VectorSearch(QueryEncoder(FakeEmbeddingModel([1.0, 0.0])), repository)

    results = search.search("nearest document", limit=2)

    assert [result.chunk.chunk_id for result in results] == ["chunk-1", "chunk-2"]
    assert results[0].score == pytest.approx(1.0)
    assert results[1].score == pytest.approx(0.0)


def test_vector_repository_validates_dimensions_and_can_delete_a_document():
    repository = InMemoryVectorRepository()
    chunk = DocumentChunk("doc-1", "chunk-1", "text", 0)
    repository.upsert([chunk], [[1.0, 0.0]])

    with pytest.raises(ValueError, match="dimensions"):
        repository.search([1.0], 1)

    repository.delete_document("doc-1")
    assert repository.search([1.0, 0.0], 1) == []


def test_cosine_similarity_rejects_empty_or_incompatible_vectors():
    assert cosine_similarity([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)
    with pytest.raises(ValueError, match="same dimensions"):
        cosine_similarity([1.0], [1.0, 0.0])