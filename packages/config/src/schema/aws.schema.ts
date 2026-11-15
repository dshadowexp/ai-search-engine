import { z } from "zod";

export const awsSchema = z.object({
    AWS_REGION: z.string().min(1),

    AWS_ACCESS_KEY_ID: z.string().optional(),

    AWS_SECRET_ACCESS_KEY: z.string().optional(),
});