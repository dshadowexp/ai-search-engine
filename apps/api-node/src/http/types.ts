import type { IncomingMessage, ServerResponse } from "node:http";

declare module "node:http" {
    interface IncomingMessage {
        query: URLSearchParams;
        abortSignal: AbortSignal;
    }
}

export type HTTPMethod = "options" | "get" | "post";
export type NextFunction = (err?: Error) => void;

export type Middleware = (
    req: IncomingMessage,
    res: ServerResponse,
    next: NextFunction
) => void;
 
export type ErrorMiddleware = (
    err: Error,
    req: IncomingMessage,
    res: ServerResponse,
    next: NextFunction
) => void;

export type Route = {
    method: HTTPMethod;
    path: string;
    handlers: Middleware[];
};