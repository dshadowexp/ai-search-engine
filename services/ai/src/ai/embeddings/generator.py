import numpy as np

from services.ai.src.ai.config import Settings
from services.ai.src.ai.embeddings.embedder import Embedder
from services.ai.src.ai.models.chunks import DocumentChunk


def generate_embeddings(chunks: list[DocumentChunk],) -> list[dict]:
    if not chunks:
        return []

    texts = [chunk.content for chunk in chunks]

    model = Embedder(Settings.EMBEDDING_MODEL)
    embeddings = model.encode_documents(texts)

    return [
        {
            "chunk_id": chunk.chunk_id,
            "document_id": chunk.document_id,
            "chunk_index": chunk.chunk_index,
            "content": chunk.content,
            "embedding": embedding.astype(np.float32),
        }
        for chunk, embedding in zip(chunks, embeddings)
    ]