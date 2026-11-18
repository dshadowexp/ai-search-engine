import json
import asyncio
import logging

from ai.infrastructure.blob_store import get_document
from ai.pipeline.ingestion import ingest_document

logger = logging.getLogger(__name__)


async def process_message(message: dict):

    message_id = message.get("MessageId", "unknown")
    payload = json.loads(message["Body"])

    document_id = payload["documentId"]
    bucket = payload.get("bucket", "documents")
    key = payload["key"]

    logger.info(
        "Processing document %s from s3://%s/%s (message %s)",
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

    if document.document_id != document_id:
        raise ValueError("Document ID mismatch")

    logger.info(
        "Loaded document %s (%d characters)",
        document.document_id,
        len(document.content),
    )

    chunks = await ingest_document(document)

    logger.info(
        "Finished indexing document %s: %d chunks",
        document.document_id,
        len(chunks),
    )

    return chunks
