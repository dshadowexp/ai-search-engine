import asyncio
import json
import logging
import os

from ai.config import Settings
from ai.infrastructure.aws import sqs
from ai.infrastructure.blob_store import get_document
from ai.pipeline.ingestion import ingest_document

logger = logging.getLogger(__name__)

MAX_CONCURRENCY = int(
    os.getenv("SQS_MAX_CONCURRENCY", "10")
)

VISIBILITY_TIMEOUT = int(
    os.getenv("SQS_VISIBILITY_TIMEOUT", "300")
)

WAIT_TIME = 20

semaphore = asyncio.Semaphore(MAX_CONCURRENCY)


async def process_message(message: dict):
    message_id = message.get("MessageId", "unknown")
    payload = json.loads(message["Body"])
    reference = payload["document"]
    document_id = reference["documentId"]
    version = reference["version"]
    content_hash = reference["contentHash"]
    bucket = reference.get("bucket", "documents")
    key = reference["key"]

    logger.info(
        "Processing indexed document %s from s3://%s/%s (message %s)",
        document_id,
        bucket,
        key,
        message_id,
    )

    document = await asyncio.to_thread(
        get_document,
        bucket,
        key,
    )

    if (
        document.document_id != document_id
        or document.version != version
        or document.content_hash != content_hash
    ):
        raise ValueError("S3 document does not match indexed document reference")

    logger.info(
        "Loaded indexed document %s (%d characters)",
        document.document_id,
        len(document.content),
    )

    chunks = await ingest_document(document)
    logger.info(
        "Finished processing indexed document %s: %d chunks stored",
        document.document_id,
        len(chunks),
    )


async def handle_message(message: dict):
    async with semaphore:
        receipt_handle = message["ReceiptHandle"]

        try:
            await process_message(message)

            # Acknowledge only after successful processing.
            await asyncio.to_thread(
                sqs.delete_message,
                QueueUrl=Settings.SEMANTIC_SQS_QUEUE_URL,
                ReceiptHandle=receipt_handle,
            )

            logger.info(
                "Acknowledged indexed document message %s",
                message.get("MessageId", "unknown"),
            )

        except Exception:
            logger.exception(
                "Failed to process indexed document message %s; it will remain available for retry",
                message.get("MessageId", "unknown"),
            )


async def poll():
    while True:
        response = await asyncio.to_thread(
            sqs.receive_message,
            QueueUrl=Settings.SEMANTIC_SQS_QUEUE_URL,
            MaxNumberOfMessages=10,
            WaitTimeSeconds=WAIT_TIME,
            VisibilityTimeout=VISIBILITY_TIMEOUT,
        )

        messages = response.get("Messages", [])

        if not messages:
            continue

        logger.info("Received %d indexed document message(s)", len(messages))
        tasks = [
            asyncio.create_task(handle_message(message))
            for message in messages
        ]

        await asyncio.gather(*tasks)
