import unittest

from src.grpc.server import GrpcServer


class GrpcServerTests(unittest.IsolatedAsyncioTestCase):
    async def test_starts_on_an_ephemeral_port_and_stops(self):
        server = GrpcServer("127.0.0.1:0")
        self.assertGreater(server.bound_port, 0)

        await server.start()
        await server.stop()

        with self.assertRaises(RuntimeError):
            await server.start()

    async def test_requires_start_before_waiting(self):
        server = GrpcServer("127.0.0.1:0")
        with self.assertRaises(RuntimeError):
            await server.wait_for_termination()
        await server.stop()


if __name__ == "__main__":
    unittest.main()
