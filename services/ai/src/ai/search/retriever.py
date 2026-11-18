from typing import List

from qdrant_client import AsyncQdrantClient, models


class QdrantRetriever:
    def __init__(self, url: str, collection: str):
        self.client = AsyncQdrantClient(url=url)
        self.collection = collection

    async def search(
        self,
        vector: list[float],
        top_k: int,
        filters: dict[str, str]
    ) -> List[models.ScoredPoint]:
        conditions: list[models.Condition] = [
            models.FieldCondition(
                key=key,
                match=models.MatchValue(value=value)
            )
            for key, value in filters.items()
        ]

        query_filter = (
            models.Filter(must=conditions)
            if conditions else None
        )

        response = await self.client.query_points(
            collection_name=self.collection,
            query=vector,
            query_filter=query_filter,
            limit=top_k,
            with_payload=True
        )

        return response.points

    async def close(self):
        await self.client.close()