import { Writable } from "node:stream";

export class LogStream {
    private static instance: LogStream | null = null;
    private readonly streams: Writable[];

    private constructor() {
        this.streams = [];
    }

    static getInstance(): LogStream {
        if (!LogStream.instance) {
            LogStream.instance = new LogStream();
        }
        return LogStream.instance;
    }

    addStream(writableStream: Writable) {
        this.streams.push(writableStream);
    }

    log(body: any, actor?: string | undefined, error: boolean = false): void {
        for(const stream of this.streams) {
            let logType = `LOG`;
            if (error)
                logType = `ERROR`
            stream.write(`${actor ? `[${actor}]` : `[${logType}]`}: ${JSON.stringify(body)}\n`);
        }
    } 
}