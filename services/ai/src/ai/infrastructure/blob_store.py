import gzip
import io
import json

from ai.config import Settings
from ai.infrastructure.aws import s3
from ai.models.indexed_document import IndexedDocument

MAX_COMPRESSED_DOCUMENT_SIZE = 10 * 1024 * 1024
MAX_DOCUMENT_SIZE = 10 * 1024 * 1024
INDEXED_DOCUMENT_SCHEMA_VERSION = 1


def get_document(bucket: str, key: str) -> IndexedDocument:
    if bucket != Settings.S3_BUCKET:
        raise ValueError("Unexpected S3 bucket")

    if not key.startswith("indexed-documents/"):
        raise ValueError("Invalid document key")

    response = s3.get_object(
        Bucket=bucket,
        Key=key,
    )

    try:
        if response["ContentLength"] > MAX_COMPRESSED_DOCUMENT_SIZE:
            raise ValueError("Compressed document exceeds maximum size")

        compressed_data = response["Body"].read(MAX_COMPRESSED_DOCUMENT_SIZE + 1)
        if len(compressed_data) > MAX_COMPRESSED_DOCUMENT_SIZE:
            raise ValueError("Compressed document exceeds maximum size")

        with gzip.GzipFile(fileobj=io.BytesIO(compressed_data), mode="rb") as stream:
            raw_data = stream.read(MAX_DOCUMENT_SIZE + 1)
        if len(raw_data) > MAX_DOCUMENT_SIZE:
            raise ValueError("Uncompressed document exceeds maximum size")

        envelope = json.loads(raw_data)
        if (
            not isinstance(envelope, dict)
            or envelope.get("schemaVersion") != INDEXED_DOCUMENT_SCHEMA_VERSION
            or not isinstance(envelope.get("document"), dict)
        ):
            raise ValueError("Invalid indexed document envelope")

        return IndexedDocument.model_validate(envelope["document"])
    finally:
        response["Body"].close()