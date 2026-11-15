import { z } from "zod";

export const postgresSchema = z.object({
    POSTGRES_HOST: z.string().min(1),

    POSTGRES_PORT: z.coerce.number().default(5432),

    POSTGRES_USER: z.string().min(1),

    POSTGRES_PASSWORD: z.string().min(1),

    POSTGRES_DATABASE: z.string().min(1),
});