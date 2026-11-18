import os


class Settings:
    GRPC_HOST = os.getenv("GRPC_HOST", "0.0.0.0")
    GRPC_PORT = int(os.getenv("GRPC_PORT", "50051"))

    AWS_REGION = os.getenv(
        "AWS_REGION",
        "us-east-1"
    )

    AWS_REGION = os.getenv(
        "AWS_REGION",
        "us-east-1"
    )

    AWS_ACCESS_KEY_ID = os.getenv(
        "AWS_ACCESS_KEY_ID",
        "test"
    )

    AWS_SECRET_ACCESS_KEY = os.getenv(
        "AWS_SECRET_ACCESS_KEY",
        "test"
    )

    S3_BUCKET = os.getenv(
        "S3_BUCKET",
        "documents"
    )

    S3_ENDPOINT = os.getenv(
        "S3_ENDPOINT",
        "http://localhost:4566"
    )

    SQS_ENDPOINT = os.getenv(
        "SQS_ENDPOINT",
        "https://localhost.localstack.cloud:4566"
    )

    SEMANTIC_SQS_QUEUE_URL = os.getenv(
        "SEMANTIC_SQS_QUEUE_URL",
        "https://localhost.localstack.cloud:4566/000000000000/indexed-documents"
    )

    DATABASE_URL = os.getenv(
        "DATABASE_URL",
        "https://localhost.localstack.cloud:4566"
    )

    QDRANT_URL = os.getenv(
        "QDRANT_URL",
        "http://localhost:6333"
    )

    QDRANT_API_KEY = os.getenv(
        "QDRANT_API_KEY",
        "http://localhost:6333"
    )

    QDRANT_COLLECTION = os.getenv(
        "QDRANT_COLLECTION",
        "documents"
    )

    EMBEDDING_MODEL = os.getenv(
        "EMBEDDING_MODEL",
        "BAAI/bge-small-en-v1.5"
    )

    RERANKER_MODEL = os.getenv(
        "RERANKER_MODEL",
        "BAAI/bge-reranker-base"
    )

    DEFAULT_TOP_K = 10
    MAX_TOP_K = 100
    CANDIDATE_MULTIPLIER = 5