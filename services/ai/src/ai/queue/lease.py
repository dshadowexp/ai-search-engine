import asyncio
import logging
from collections.abc import Awaitable, Callable

from ai.infrastructure.aws import sqs

logger = logging.getLogger(__name__)


class SQSMessageLease:

    def __init__(
        self,
        queue_url: str,
        receipt_handle: str,
        visibility_timeout: int,
        on_renew: Callable[[], Awaitable[bool]] | None = None,
    ):
        self.queue_url = queue_url
        self.receipt_handle = receipt_handle
        self.visibility_timeout = visibility_timeout
        self.on_renew = on_renew

        self._task: asyncio.Task | None = None
        self._stopped = False

    async def start(self):
        self._task = asyncio.create_task(
            self._renew_loop()
        )

    async def stop(self):
        self._stopped = True

        if self._task:
            self._task.cancel()

            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _renew_loop(self):

        interval = max(
            1,
            self.visibility_timeout // 3,
        )

        while not self._stopped:
            try:
                await asyncio.sleep(interval)

                if self._stopped:
                    break

                await asyncio.to_thread(
                    sqs.change_message_visibility,
                    QueueUrl=self.queue_url,
                    ReceiptHandle=self.receipt_handle,
                    VisibilityTimeout=self.visibility_timeout,
                )

                if self.on_renew:
                    renewed = await self.on_renew()

                    if not renewed:
                        logger.error(
                            "Lost PostgreSQL processing lease"
                        )

                logger.debug(
                    "Renewed SQS message visibility timeout"
                )

            except asyncio.CancelledError:
                raise

            except Exception:
                logger.exception(
                    "Failed to renew message lease"
                )
