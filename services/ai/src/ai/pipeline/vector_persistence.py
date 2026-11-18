from uuid import NAMESPACE_URL, uuid5

from ai.config import Settings
from ai.infrastructure.qdrant import client
from ai.models.indexed_document import IndexedDocument
from qdrant_client.models import (
    Condition,
    FieldCondition,
    Filter,
    MatchValue,
    PointStruct,
    Range,
)


def create_point_id(document_id: str, chunk_index: int) -> str:
    identity = f"{document_id}:{chunk_index}:bge-small-v1.5:v1"
    return str(uuid5(NAMESPACE_URL, identity))


async def store_embeddings(document: IndexedDocument, embeddings: list[dict]):
    points = []

    for item in embeddings:
        point_id = create_point_id(
            item["document_id"],
            item["chunk_index"],
        )

        points.append(
            PointStruct(
                id=point_id,
                vector=item["embedding"].tolist(),
                payload={
                    "document_id": document.document_id,
                    "chunk_id": item["chunk_id"],
                    "chunk_index": item["chunk_index"],
                    "content": item["content"],
                    "url": str(document.url),
                    "title": document.title,
                    "language": document.language,
                },
            )
        )

    batch_size = 128

    for start in range(0, len(points), batch_size):

        await client.upsert(
            collection_name=Settings.QDRANT_COLLECTION,
            points=points[start:start + batch_size],
            wait=True,
        )


async def remove_stale_chunks(document_id: str, new_chunk_count: int):
    conditions: list[Condition] = [
        FieldCondition(
            key="document_id",
            match=MatchValue(value=document_id),
        )
    ]

    if new_chunk_count > 0:
        conditions.append(
            FieldCondition(
                key="chunk_index",
                range=Range(gte=new_chunk_count),
            )
        )

    await client.delete(
        collection_name=Settings.QDRANT_COLLECTION,
        points_selector=Filter(must=conditions),
        wait=True,
    )