import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from ai.workers import indexing_consumer


class IndexingConsumerTests(unittest.IsolatedAsyncioTestCase):
    async def test_logs_processing_and_acknowledges_after_ingestion(self) -> None:
        document = SimpleNamespace(
            document_id="doc-1",
            content="Indexed content",
            version=2,
            content_hash="a" * 64,
        )
        message = {
            "MessageId": "message-1",
            "ReceiptHandle": "receipt-1",
            "Body": json.dumps(
                {
                    "schemaVersion": 1,
                    "eventType": "indexer.document.ready_for_semantic_index",
                    "eventId": "doc-1@2",
                    "document": {
                        "documentId": "doc-1",
                        "key": "indexed-documents/doc-1/v2.json.gz",
                        "version": 2,
                        "contentHash": "a" * 64,
                    },
                }
            ),
        }
        ingest = AsyncMock(return_value=[object(), object()])

        with (
            patch.object(indexing_consumer, "get_document", return_value=document),
            patch.object(indexing_consumer, "ingest_document", ingest),
            patch.object(indexing_consumer.sqs, "delete_message") as delete_message,
            self.assertLogs("ai.workers.indexing_consumer", level="INFO") as output,
        ):
            await indexing_consumer.handle_message(message)

        ingest.assert_awaited_once_with(document)
        delete_message.assert_called_once_with(
            QueueUrl=indexing_consumer.Settings.SEMANTIC_SQS_QUEUE_URL,
            ReceiptHandle="receipt-1",
        )
        self.assertTrue(
            any("Finished processing indexed document doc-1: 2 chunks stored" in line
                for line in output.output)
        )
        self.assertTrue(
            any("Acknowledged indexed document message message-1" in line
                for line in output.output)
        )
