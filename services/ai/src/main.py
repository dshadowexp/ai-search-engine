import asyncio
import logging
import os

from src.embeddings.model import EmbeddingModel
from src.grpc.server import GrpcServer
from src.grpc.services.semantic_search import SemanticSearchServicer
from src.retrieval.query_encoder import QueryEncoder
from src.retrieval.vector_search import VectorSearch
from src.storage.vector_store import InMemoryVectorRepository

logger = logging.getLogger(__name__)


async def consume_queue():
    while True:
        ...


def create_semantic_search_servicer() -> SemanticSearchServicer:
    model = EmbeddingModel()
    query_encoder = QueryEncoder(model)
    vector_search = VectorSearch(query_encoder, InMemoryVectorRepository())
    return SemanticSearchServicer(vector_search, query_encoder, model)


async def serve_grpc(semantic_search: SemanticSearchServicer):
    port = int(os.getenv("GRPC_PORT", "50051"))
    server = GrpcServer(f"0.0.0.0:{port}")
    server.add_semantic_search_service(semantic_search)

    await server.start()
    logger.info("gRPC server running on %s:%s", "0.0.0.0", port)

    try:
        await server.wait_for_termination()
    finally:
        await server.stop(grace=10)


async def main():
    semantic_search = create_semantic_search_servicer()
    await asyncio.gather(
        serve_grpc(semantic_search),
        consume_queue(),
    )


if __name__ == "__main__":
    asyncio.run(main())
