import { resolve } from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

import { envSchema } from "./schema/index.js";

const envPath = resolve(
    process.cwd(),
    ".env"
);

dotenv.config({ path: envPath });

const result = envSchema.safeParse({
    app: {
        NODE_ENV: process.env.NODE_ENV,
        PORT: process.env.PORT,
        LOG_LEVEL: process.env.LOG_LEVEL,
    },

    aws: {
        AWS_REGION: process.env.AWS_REGION,
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    },

    postgres: {
        POSTGRES_HOST: process.env.POSTGRES_HOST,
        POSTGRES_PORT: process.env.POSTGRES_PORT,
        POSTGRES_USER: process.env.POSTGRES_USER,
        POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
        POSTGRES_DATABASE: process.env.POSTGRES_DATABASE,
    },

    s3: {
        S3_BUCKET: process.env.S3_BUCKET,
        S3_REGION: process.env.S3_REGION,
        S3_ENDPOINT: process.env.S3_ENDPOINT,
    },
});

if (!result.success) {
    console.error(z.treeifyError(result.error));
    process.exit(1);
}

export const config = result.data;