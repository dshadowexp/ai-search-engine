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
    AWS_REGION: z.string().trim().min(1),
    S3_BUCKET: z.string().trim().min(1),
    S3_REGION: optionalRegionSchema,
    S3_ENDPOINT: optionalHttpUrlSchema,
    SQS_ENDPOINT: optionalHttpUrlSchema,
    SQS_QUEUE_URL: httpUrlSchema,
}).transform((env) => ({
    awsRegion: env.AWS_REGION,
    s3Bucket: env.S3_BUCKET,
    s3Region: env.S3_REGION ?? env.AWS_REGION,
    ...(env.S3_ENDPOINT ? { s3Endpoint: env.S3_ENDPOINT } : {}),
    sqsQueueUrl: env.SQS_QUEUE_URL,
    ...(env.SQS_ENDPOINT ? { sqsEndpoint: env.S3_ENDPOINT } : {}),
}));
