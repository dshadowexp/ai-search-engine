import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";

export interface AwsConfig {
  region: string;
}

const common = (cfg: AwsConfig) => ({
  region: cfg.region,
});

export const createS3Client = (cfg: AwsConfig): S3Client => new S3Client({ ...common(cfg) });
export const createSqsClient = (cfg: AwsConfig): SQSClient => new SQSClient({ ...common(cfg) });
