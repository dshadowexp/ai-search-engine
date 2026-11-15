import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import type { AwsConfig } from "../config/config.js";

const common = (cfg: AwsConfig) => ({
  region: cfg.region,
  endpoint: cfg.endpoint,
  maxAttempts: cfg.maxAttempts,
  // Credentials are deliberately absent: the SDK's default provider chain (ECS task role, env, profile) supplies them.
  requestHandler: { requestTimeout: cfg.requestTimeoutMs, connectionTimeout: cfg.connectionTimeoutMs },
});

export const createS3Client = (cfg: AwsConfig): S3Client => new S3Client({ ...common(cfg), forcePathStyle: cfg.forcePathStyle });
export const createSqsClient = (cfg: AwsConfig): SQSClient => new SQSClient(common(cfg));
