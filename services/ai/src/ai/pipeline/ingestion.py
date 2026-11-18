from ai.models.indexed_document import IndexedDocument
from ai.models.chunks import DocumentChunk
from ai.pipeline.chunker import chunk_document
from ai.embeddings.generator import generate_embeddings
from ai.pipeline.vector_persistence import (
    store_embeddings,
    remove_stale_chunks,
)


async def ingest_document(document: IndexedDocument) -> list[DocumentChunk]:
    chunks = chunk_document(document)

    embeddings = generate_embeddings(chunks)

    await store_embeddings(document, embeddings)

    await remove_stale_chunks(
        document.document_id,
        len(chunks),
    )

    return chunks