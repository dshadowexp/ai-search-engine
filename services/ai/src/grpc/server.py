from collections.abc import Callable

import grpc

ServiceRegistration = Callable[[grpc.aio.Server], None]


class GrpcServer:
    """Owns the lifecycle of an asyncio gRPC server."""

    def __init__(self, address: str):
        if not address.strip():
            raise ValueError("gRPC address must not be empty")

        self._server = grpc.aio.server()
        self._started = False
        self._closed = False
        self.bound_port = self._server.add_insecure_port(address)
        if self.bound_port == 0:
            raise RuntimeError(f"Could not bind gRPC server to {address}")

    def add_service(self, register: ServiceRegistration) -> None:
        if self._started or self._closed:
            raise RuntimeError("gRPC services must be registered before the server starts")
        register(self._server)

    async def start(self) -> None:
        if self._closed:
            raise RuntimeError("gRPC server has been stopped")
        if not self._started:
            await self._server.start()
            self._started = True

    async def wait_for_termination(self) -> None:
        if not self._started:
            raise RuntimeError("gRPC server must be started before waiting for termination")
        await self._server.wait_for_termination()

    async def stop(self, grace: float = 5.0) -> None:
        if grace < 0:
            raise ValueError("grace must be non-negative")
        if self._closed:
            return

        self._closed = True
        if self._started:
            await self._server.stop(grace)
            self._started = False

    async def serve(self) -> None:
        await self.start()
        try:
            await self.wait_for_termination()
        finally:
            await self.stop()