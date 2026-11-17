import { z } from "zod";

const emptyStringAsUndefined = (value: unknown) =>
    typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalRegionSchema = z.preprocess(
    emptyStringAsUndefined,
    z.string().trim().min(1).optional(),
);

const httpUrlSchema = z.string().trim().url().refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    "must use HTTP or HTTPS",
);
const optionalHttpUrlSchema = z.preprocess(emptyStringAsUndefined, httpUrlSchema.optional());

export const envSchema = z.object({
    GRPC_PORT: z.coerce.number().int().min(1).max(65535),
    AWS_REGION: z.string().trim().min(1),
    S3_BUCKET: z.string().trim().min(1),
    S3_REGION: optionalRegionSchema,
    S3_ENDPOINT: optionalHttpUrlSchema,
    SQS_ENDPOINT: optionalHttpUrlSchema,
    INDEXED_SQS_QUEUE_URL: httpUrlSchema,
    SEMANTIC_SQS_QUEUE_URL: httpUrlSchema
}).transform((env) => ({
    grpcPort: env.GRPC_PORT,
    awsRegion: env.AWS_REGION,
    s3Bucket: env.S3_BUCKET,
    s3Region: env.S3_REGION ?? env.AWS_REGION,
    ...(env.S3_ENDPOINT ? { s3Endpoint: env.S3_ENDPOINT } : {}),
    indexedSqsQueueUrl: env.INDEXED_SQS_QUEUE_URL,
    semanticSqsQueueUrl: env.SEMANTIC_SQS_QUEUE_URL,
    ...(env.SQS_ENDPOINT ? { sqsEndpoint: env.S3_ENDPOINT } : {}),
}));
