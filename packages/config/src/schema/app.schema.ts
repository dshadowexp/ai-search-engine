import { z } from "zod";

export const appSchema = z.object({
    NODE_ENV: z
        .enum(["development", "production", "test"])
        .default("development"),

    PORT: z.coerce.number().default(3000),

    LOG_LEVEL: z
        .enum(["debug", "info", "warn", "error"])
        .default("info"),
});