import asyncio
import logging
import signal
import grpc

from v1 import semantic_search_pb2_grpc

from ai.config import Settings

from ai.workers.indexing_consumer import poll

from ai.embeddings.embedder import Embedder
from ai.search.reranker import Reranker
from ai.search.retriever import QdrantRetriever
from ai.search.engines.semantic_search_engine import SemanticSearchEngine

from ai.grpc.semantic_search_servicer import SemanticSearchServicer
from ai.grpc.search_summary_servicer import SearchSummaryServicer

from ai.infrastructure.qdrant import client, initialize_qdrant

logger = logging.getLogger(__name__)


async def consume_queue(stop_event: asyncio.Event) -> None:
    consumer_task = asyncio.create_task(poll())
    logger.info("SQS consumer started")

    try:
        await stop_event.wait()
    finally:
        consumer_task.cancel()
        try:
            await consumer_task
        except asyncio.CancelledError:
            pass
        logger.info("SQS consumer stopped")


async def serve_grpc(stop_event: asyncio.Event) -> None:
    vector_store = QdrantRetriever(
        Settings.QDRANT_URL,
        Settings.QDRANT_COLLECTION
    )
    server = grpc.aio.server()

    try:
        embedder = Embedder(Settings.EMBEDDING_MODEL)
        reranker = Reranker(Settings.RERANKER_MODEL)
    
        search_engine = SemanticSearchEngine(
            embedder,
            vector_store,
            reranker
        )
        
        semantic_search_servicer = SemanticSearchServicer(search_engine)

        semantic_search_pb2_grpc.add_SemanticSearchServiceServicer_to_server(
            semantic_search_servicer,
            server
        )

        address = f"{Settings.GRPC_HOST}:{Settings.GRPC_PORT}"
        if server.add_insecure_port(address) == 0:
            raise RuntimeError(f"Could not bind gRPC server to {address}")

        await server.start()
        logger.info("gRPC server running on %s", address)

        await stop_event.wait()
        logger.info("Stopping gRPC server")

    finally:
        try:
            await server.stop(grace=10)
        finally:
            await vector_store.close()

        logger.info("AI service shut down")


async def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    signals = (signal.SIGINT, signal.SIGTERM)

    def request_shutdown() -> None:
        if not stop_event.is_set():
            logger.info("Shutdown initiated")
            stop_event.set()

    for sig in signals:
        loop.add_signal_handler(sig, request_shutdown)

    tasks: list[asyncio.Task[None]] = []
    try:
        await initialize_qdrant(Settings.QDRANT_COLLECTION)
        logger.info("Qdrant collection %s is ready", Settings.QDRANT_COLLECTION)

        grpc_task = asyncio.create_task(serve_grpc(stop_event))
        consumer_task = asyncio.create_task(consume_queue(stop_event))
        tasks.extend((grpc_task, consumer_task))
        await asyncio.gather(grpc_task, consumer_task)
    finally:
        stop_event.set()
        for sig in signals:
            loop.remove_signal_handler(sig)
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
