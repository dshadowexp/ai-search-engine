import type { Middleware } from "./types.ts";

export const cors: Middleware = (req, res, next) => {
    next();
}

export const helmet: Middleware = (req, res, next) => {
    next();
}

export const cleanseQuery: Middleware = (req, res, next) => {
    next();
}