import { z } from "zod";

export const s3Schema = z.object({
    S3_BUCKET: z.string().min(1),

    S3_REGION: z.string().min(1),

    S3_ENDPOINT: z.string().url().optional(),
});