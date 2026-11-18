from ai.config import Settings

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    PayloadSchemaType,
)

client = AsyncQdrantClient(
    url=Settings.QDRANT_URL,
    api_key=Settings.QDRANT_API_KEY,
    timeout=30,
)

VECTOR_SIZE = 384


async def initialize_qdrant(collection: str):

    exists = await client.collection_exists(
        collection_name=collection
    )

    if not exists:
        await client.create_collection(
            collection_name=collection,
            vectors_config=VectorParams(
                size=VECTOR_SIZE,
                distance=Distance.COSINE,
            ),
        )

    await client.create_payload_index(
        collection_name=collection,
        field_name="document_id",
        field_schema=PayloadSchemaType.KEYWORD,
    )