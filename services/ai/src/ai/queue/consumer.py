
# indexing_consumer.py

import asyncio
import logging
import os

import asyncpg

from ai.config import Settings
from ai.infrastructure.aws import sqs

from .deduplicator import DeduplicationStore
from .handler import handle_message

logger = logging.getLogger(__name__)

MAX_CONCURRENCY = int(
    os.getenv("SQS_MAX_CONCURRENCY", "10")
)

VISIBILITY_TIMEOUT = int(
    os.getenv("SQS_VISIBILITY_TIMEOUT", "300")
)

WAIT_TIME = 20

MAX_MESSAGES = min(MAX_CONCURRENCY, 10)


async def poll():
    pool = await asyncpg.create_pool(
        dsn=Settings.DATABASE_URL,
        min_size=2,
        max_size=MAX_CONCURRENCY + 2,
    )

    deduplication = DeduplicationStore(pool)

    semaphore = asyncio.Semaphore(MAX_CONCURRENCY)

    logger.info("Starting indexing consumer")

    try:
        while True:

            response = await asyncio.to_thread(
                sqs.receive_message,
                QueueUrl=Settings.SEMANTIC_SQS_QUEUE_URL,
                MaxNumberOfMessages=MAX_MESSAGES,
                WaitTimeSeconds=WAIT_TIME,
                VisibilityTimeout=VISIBILITY_TIMEOUT,
            )

            messages = response.get("Messages", [])

            if not messages:
                continue

            logger.info(
                "Received %d indexed document message(s)",
                len(messages),
            )

            tasks = [
                asyncio.create_task(
                    handle_message(
                        message=message,
                        deduplication=deduplication,
                        semaphore=semaphore,
                        visibility_timeout=VISIBILITY_TIMEOUT,
                    )
                )
                for message in messages
            ]

            await asyncio.gather(
                *tasks,
                return_exceptions=True,
            )

    finally:
        await pool.close()
