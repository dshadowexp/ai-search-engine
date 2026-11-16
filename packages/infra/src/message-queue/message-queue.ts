/** A Zod schema or another runtime parser with the same parse contract. */
export interface MessageSchema<T> {
    parse(value: unknown): T;
}

export interface ConsumeOptions {
    concurrency?: number;
    /** SQS receive batches contain at most 10 messages. */
    batchSize?: number;
    visibilityTimeoutSeconds?: number;
    waitTimeSeconds?: number;
}

export interface QueueConsumer {
    stop(): Promise<void>;
}

export interface MessageQueueProducer<T> {
    publish(message: T): Promise<void>;
}

export interface MessageQueueConsumer<T> {
    consume(
        handler: (message: T) => Promise<void>,
        options?: ConsumeOptions
    ): QueueConsumer;
}

/** Combined adapter for transports that support both producer and consumer roles. */
export interface MessageQueue<T> extends MessageQueueProducer<T>, MessageQueueConsumer<T> {}

export function encodeQueueMessage<T>(message: T, schema: MessageSchema<T>): { message: T; body: string } {
    const parsed = schema.parse(message);
    const body = JSON.stringify(parsed);
    if (typeof body !== "string") {
        throw new TypeError("Queue message must serialize to a JSON string");
    }

    return { message: parsed, body };
}

export function decodeQueueMessage<T>(body: string, schema: MessageSchema<T>): T {
    const parsed: unknown = JSON.parse(body);
    return schema.parse(parsed);
}