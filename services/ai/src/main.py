import asyncio
import logging
import os

from src.grpc.server import GrpcServer

logger = logging.getLogger(__name__)


async def consume_queue():
    while True:
        ...


async def serve_grpc():
    host = os.getenv("GRPC_HOST", "0.0.0.0")
    port = int(os.getenv("GRPC_PORT", "50051"))
    server = GrpcServer(f"{host}:{port}")

    # Register your gRPC services here.
    # add_SearchServiceServicer_to_server(..., server)

    # server.add_service()

    await server.start()
    logger.info("gRPC server running on %s:%s", host, port)

    try:
        await server.wait_for_termination()
    finally:
        await server.stop(grace=10)


async def main():
    await asyncio.gather(
        serve_grpc(),
        consume_queue()
    )


if __name__ == "__main__":
    asyncio.run(main())
