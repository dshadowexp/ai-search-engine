from ai.config import Settings

import boto3
from botocore.config import Config


aws_config = Config(
    region_name=Settings.AWS_REGION,
    retries={
        "max_attempts": 5,
        "mode": "standard",
    },
    connect_timeout=5,
    read_timeout=30,
)

session = boto3.Session(
    region_name=Settings.AWS_REGION,
    aws_access_key_id=Settings.AWS_ACCESS_KEY_ID,
    aws_secret_access_key=Settings.AWS_SECRET_ACCESS_KEY
)

sqs = session.client(
    "sqs",
    endpoint_url=Settings.SQS_ENDPOINT,
    config=aws_config,
)

s3 = session.client(
    "s3",
    endpoint_url=Settings.S3_ENDPOINT,
    config=aws_config,
)