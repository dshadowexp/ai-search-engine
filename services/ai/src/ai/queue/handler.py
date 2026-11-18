import asyncio
import json
import logging

from ai.config import Settings
from ai.infrastructure.aws import sqs

from .deduplicator import DeduplicationStore
from .lease import SQSMessageLease
from .processor import process_message

logger = logging.getLogger(__name__)


async def acknowledge(receipt_handle: str):
    await asyncio.to_thread(
        sqs.delete_message,
        QueueUrl=Settings.SEMANTIC_SQS_QUEUE_URL,
        ReceiptHandle=receipt_handle,
    )


async def handle_message(
    message: dict,
    deduplication: DeduplicationStore,
    semaphore: asyncio.Semaphore,
    visibility_timeout: int,
):

    async with semaphore:

        message_id = message.get("MessageId", "unknown")
        receipt_handle = message["ReceiptHandle"]

        try:
            payload = json.loads(message["Body"])

            document_id = payload["documentId"]
            key = payload["key"]

            # Prefer an explicit document version.
            # Fall back to the S3 object key for older messages.
            document_version = (
                payload.get("documentVersion")
                or payload.get("versionId")
                or payload.get("etag")
                or key
            )

            claim = await deduplication.claim(
                document_id=document_id,
                document_version=document_version,
                lease_seconds=visibility_timeout * 2,
            )

            if claim["status"] == "completed":

                logger.info(
                    "Document %s version %s already indexed",
                    document_id,
                    document_version,
                )

                await acknowledge(receipt_handle)
                return

            if claim["status"] == "busy":

                logger.info(
                    "Document %s is already being processed; "
                    "leaving message for retry",
                    document_id,
                )

                return

            key = claim["key"]
            token = claim["token"]

            async def renew_database_lease():
                return await deduplication.renew(
                    key,
                    token,
                    lease_seconds=visibility_timeout * 2,
                )

            lease = SQSMessageLease(
                queue_url=Settings.SEMANTIC_SQS_QUEUE_URL,
                receipt_handle=receipt_handle,
                visibility_timeout=visibility_timeout,
                on_renew=renew_database_lease,
            )

            await lease.start()

            try:
                await process_message(message)

                completed = await deduplication.complete(
                    key,
                    token,
                )

                if not completed:
                    raise RuntimeError(
                        "Lost processing ownership; "
                        "cannot acknowledge message"
                    )

                await acknowledge(receipt_handle)

                logger.info(
                    "Successfully indexed and acknowledged "
                    "document %s (message %s)",
                    document_id,
                    message_id,
                )

            except Exception:
                await deduplication.fail(key, token)
                raise

            finally:
                await lease.stop()

        except Exception:

            logger.exception(
                "Failed to process indexed document message %s; "
                "message will be retried",
                message_id,
            )
