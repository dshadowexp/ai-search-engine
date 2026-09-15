import { createServer, type Server, IncomingMessage, ServerResponse } from "node:http";
import type { ErrorMiddleware, HTTPMethod, Middleware, NextFunction, Route } from "./types.js";

class HTTPServer {
    private server: Server;
    private routes: Route[] = [];
    private middlewares: Middleware[] = [];

    constructor() {
        this.server = createServer();
        this.routes = [];

        this.server.on("request", (req, res) => {
            // res.end('Hello');
            // return;
            this.runMiddlewares(req, res, 0);
            console.log(this.middlewares.length, req.method, req.url);
            
        });
    }

    listen(port: number, callback?: () => void) {
        this.server.listen(port, callback);
    }

    beforeEach(handler: Middleware) {
        this.middlewares.push(handler);
    }

    get(path: string, ...handlers: Middleware[]) {
        return this.route("get", path, ...handlers);
    }

    post(path: string, ...handlers: Middleware[]) {
        return this.route("post", path, ...handlers);
    }

    setRequestTimeout(ms: number) {
        this.server.requestTimeout = ms;
    }

    private route(method: HTTPMethod, path: string, ...handlers: Middleware[]) {
        this.routes.push({ method, path, handlers });
        return this;
    }

    private runMiddlewares(req: IncomingMessage, res: ServerResponse, index: number) {
        console.log(index);
        if (this.middlewares.length === 0 || index === this.middlewares.length) {
            const method = (req.method ?? "GET").toLowerCase() as HTTPMethod;
            const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        
            req.query = url.searchParams;

            const abortController = new AbortController();
            req.abortSignal = abortController.signal;
            req.on("close", () => {
                if (!res.writableEnded)
                    abortController.abort();
            });
        
            const route = this.routes.find(
                (r) => r.method === method && r.path === url.pathname
            );
        
            if (!route) {
                res.statusCode = 404;
                res.end("Not Found");
                return;
            }

            this.runHandlers(route.handlers, req, res);
        } else {
            this.middlewares[index]!(req, res, () => {
                this.runMiddlewares(req, res, index + 1);
            })
        }
    }

    private runHandlers(handlers: Middleware[], req: IncomingMessage, res: ServerResponse) {
        let index = 0;

        const next: NextFunction = (err) => {
            if (err) {
                this.errorHandler(err, req, res, next);
                return;
            }

            const handler = handlers[index];
            index++;

            if (!handler) {
                if (!res.writableEnded) {
                    res.statusCode = 404;
                    res.end("Not Found");
                }

                return;
            }

            try {
                handler(req, res, next);
            } catch (error) {
                next(error as Error);
            }
        }

        next();
    }

    private errorHandler: ErrorMiddleware = (err, _req, res) => {
        console.error(err);
        res.statusCode = 500;
        res.end("Internal Server Error");
    };
}

export default HTTPServer;