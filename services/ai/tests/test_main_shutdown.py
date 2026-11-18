import asyncio
import signal
import unittest
from unittest.mock import AsyncMock, patch

from ai import main as app_main


class MainShutdownTests(unittest.IsolatedAsyncioTestCase):
    async def test_sigint_stops_both_services_and_closes_qdrant(self) -> None:
        loop = asyncio.get_running_loop()
        handlers = {}
        service_events = []
        both_services_started = asyncio.Event()

        async def wait_for_shutdown(stop_event: asyncio.Event) -> None:
            service_events.append(stop_event)
            if len(service_events) == 2:
                both_services_started.set()
            await stop_event.wait()

        with (
            patch.object(app_main, "initialize_qdrant", new_callable=AsyncMock) as initialize,
            patch.object(app_main, "serve_grpc", side_effect=wait_for_shutdown),
            patch.object(app_main, "consume_queue", side_effect=wait_for_shutdown),
            patch.object(app_main.client, "close", new_callable=AsyncMock) as close_client,
            patch.object(
                loop,
                "add_signal_handler",
                side_effect=lambda sig, handler: handlers.__setitem__(sig, handler),
            ),
            patch.object(loop, "remove_signal_handler", return_value=True),
        ):
            main_task = asyncio.create_task(app_main.main())
            await asyncio.wait_for(both_services_started.wait(), timeout=1)

            self.assertIs(service_events[0], service_events[1])
            self.assertIn(signal.SIGINT, handlers)
            handlers[signal.SIGINT]()
            await asyncio.wait_for(main_task, timeout=1)

        initialize.assert_awaited_once()
        close_client.assert_awaited_once()
