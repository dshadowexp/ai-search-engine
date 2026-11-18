import gzip
import io
import json
import unittest
from unittest.mock import patch

from ai.config import Settings
from ai.infrastructure import blob_store


class BlobStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.document_id = "a" * 64
        self.document = {
            "id": self.document_id,
            "url": "https://example.test/article",
            "title": "Article",
            "description": None,
            "content": "Article content",
            "language": "en",
            "contentHash": "b" * 64,
            "version": 3,
            "fetchedAt": 1_700_000_000_000,
            "createdAt": 1_700_000_000_001,
        }
        self.key = f"indexed-documents/{self.document_id}/v3.json.gz"

    def make_response(self, payload: dict) -> dict:
        compressed = gzip.compress(json.dumps(payload).encode("utf-8"))
        return {
            "ContentLength": len(compressed),
            "Body": io.BytesIO(compressed),
        }

    def test_get_document_decompresses_and_validates_indexer_envelope(self) -> None:
        response = self.make_response(
            {
                "schemaVersion": 1,
                "document": self.document,
            }
        )

        with patch.object(blob_store.s3, "get_object", return_value=response):
            document = blob_store.get_document(Settings.S3_BUCKET, self.key)

        self.assertEqual(document.document_id, self.document_id)
        self.assertEqual(document.version, 3)
        self.assertEqual(document.content_hash, "b" * 64)
        self.assertEqual(document.language, "en")
        self.assertEqual(document.content, "Article content")
        self.assertTrue(response["Body"].closed)

    def test_get_document_rejects_an_unsupported_envelope_version(self) -> None:
        response = self.make_response(
            {
                "schemaVersion": 2,
                "document": self.document,
            }
        )

        with (
            patch.object(blob_store.s3, "get_object", return_value=response),
            self.assertRaisesRegex(ValueError, "Invalid indexed document envelope"),
        ):
            blob_store.get_document(Settings.S3_BUCKET, self.key)

        self.assertTrue(response["Body"].closed)

    def test_get_document_enforces_uncompressed_size_limit(self) -> None:
        response = self.make_response(
            {
                "schemaVersion": 1,
                "document": self.document,
            }
        )

        with (
            patch.object(blob_store, "MAX_DOCUMENT_SIZE", 20),
            patch.object(blob_store.s3, "get_object", return_value=response),
            self.assertRaisesRegex(ValueError, "Uncompressed document exceeds"),
        ):
            blob_store.get_document(Settings.S3_BUCKET, self.key)
