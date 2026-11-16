import { resolve } from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

export function parseConfig<TSchema extends z.ZodType>(
    schema: TSchema,
    env: Record<string, string | undefined> = process.env,
): z.infer<TSchema> {
    return schema.parse(env);
}

export function loadConfig<TSchema extends z.ZodType>(
    schema: TSchema,
    envPath = resolve(process.cwd(), ".env"),
): z.infer<TSchema> {
    dotenv.config({ path: envPath });
    return parseConfig(schema);
}
