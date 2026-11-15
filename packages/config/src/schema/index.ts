import { z } from "zod";

import { appSchema } from "./app.schema.js";
import { awsSchema } from "./aws.schema.js";
import { postgresSchema } from "./postgres.schema.js";
import { s3Schema } from "./s3.schema.js";

export const envSchema = z.object({
    app: appSchema,
    aws: awsSchema,
    postgres: postgresSchema,
    s3: s3Schema,
});

export type Config = z.infer<typeof envSchema>;