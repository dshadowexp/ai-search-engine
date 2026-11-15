import { createHash } from "node:crypto";
import { sleep } from "@search/core";
import {
    SQSClient,
    SendMessageCommand,
    SendMessageCommandInput,
    ReceiveMessageCommand,
    DeleteMessageCommand
} from "@aws-sdk/client-sqs";
import { LogStream } from "./logging/log-stream.ts";

export interface ConsumeOptions {
    concurrency?: number;
    visibilityTimeoutSeconds?: number;
    waitTimeSeconds?: number;
}

export interface QueueConsumer {
    stop(): Promise<void>;
}

export interface MessageQueue<T> {
    publish(message: T): Promise<void>;

    consume(
        handler: (message: T) => Promise<void>,
        options?: ConsumeOptions
    ): QueueConsumer;
}

export class InMemoryMessageQueue<T> implements MessageQueue<T> {
    private messages: Array<{ value: T }> = [];

    async publish(message: T): Promise<void> {
        this.messages.push({ value: message });
    }

    consume(
        handler: (message: T) => Promise<void>,
        options: ConsumeOptions = {}
    ): QueueConsumer {
        const concurrency = Math.max(1, options.concurrency ?? 1);
        const controller = new AbortController();

        const workers = Array.from(
            { length: concurrency },
            () => this.runWorker(handler, controller.signal)
        );

        return {
            stop: async () => {
                controller.abort();
                await Promise.all(workers);
            }
        };
    }

    private async runWorker(
        handler: (message: T) => Promise<void>,
        signal: AbortSignal
    ): Promise<void> {
        while (!signal.aborted) {
            const entry = this.messages.shift();

            if (!entry) {
                await sleep(25, signal);
                continue;
            }

            try {
                await handler(entry.value);
            } catch (error) {
                console.error("In-memory message processing failed:", error);

                // Requeue the failed message.
                this.messages.push(entry);

                // Simple exponential backoff is omitted here;
                // this is a local development adapter.
                await sleep(1000, signal);
            }
        }
    }
}

interface SqsMessageQueueOptions {
    delaySeconds?: number;
    attributes?: any;
    messageGroupId?: string;
    deduplicationId?: string;
}

export class SqsMessageQueue<T> implements MessageQueue<T> {
    private readonly client: SQSClient;
    private readonly options: SqsMessageQueueOptions;
    private readonly queueEndpoint: string;

    constructor(
        queueUrl: string,
        options: SqsMessageQueueOptions
    ) { 
        this.queueEndpoint = queueUrl;
        this.options = options;
        this.client = new SQSClient({
            region: process.env.AWS_REGION || 'us-east-1',
            maxAttempts: 3,
            // For local development with LocalStack or ElasticMQ
            ...(this.queueEndpoint && {
                endpoint: this.queueEndpoint,
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'local',
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'local',
                },
            }),
        });
    }

    async publish(messageBody: T): Promise<void> {
        const params: SendMessageCommandInput = {
            QueueUrl: this.queueEndpoint,
            MessageBody: typeof messageBody === 'string' ? messageBody : JSON.stringify(messageBody),
            // Delay delivery of this specific message (0-900 seconds)
            DelaySeconds: this.options.delaySeconds,
            // Custom attributes for filtering and routing
            MessageAttributes: this.options.attributes ? this.formatMessageAttributes(this.options.attributes) : undefined,

        };

        // FIFO queue specific parameters
        if (this.options.messageGroupId) {
            // Messages with the same group ID are processed in order
            params.MessageGroupId = this.options.messageGroupId;
            // Unique ID to prevent duplicate messages (required if content-based dedup is disabled)
            params.MessageDeduplicationId = this.options.deduplicationId || this.generateDeduplicationId(messageBody);
        }

        const command = new SendMessageCommand(params);
        const result = await this.client.send(command);

        // return {
        //     messageId: result.MessageId,
        //     sequenceNumber: result.SequenceNumber, // Only for FIFO queues
        // };
    }

    consume(
        handler: (message: T) => Promise<void>,
        options: ConsumeOptions = {}
    ): QueueConsumer {
        const concurrency = Math.max(1, options.concurrency ?? 1);
        const waitTimeSeconds = Math.min(
            20,
            Math.max(0, options.waitTimeSeconds ?? 20)
        );

        const visibilityTimeoutSeconds = Math.max(
            0,
            options.visibilityTimeoutSeconds ?? 120
        );

        const controller = new AbortController();

        const workers = Array.from(
            { length: concurrency },
            () =>
                this.runWorker(
                    handler,
                    controller.signal,
                    waitTimeSeconds,
                    visibilityTimeoutSeconds
                )
        );

        return {
            stop: async () => {
                controller.abort();
                await Promise.all(workers);
            }
        };
    }

    private async runWorker(
        handler: (message: T) => Promise<void>,
        signal: AbortSignal,
        waitTimeSeconds: number,
        visibilityTimeoutSeconds: number
    ): Promise<void> {
        while (!signal.aborted) {
            try {
                const response = await this.client.send(
                    new ReceiveMessageCommand({
                        QueueUrl: this.queueEndpoint,
                        MaxNumberOfMessages: 1,
                        WaitTimeSeconds: waitTimeSeconds,
                        VisibilityTimeout: visibilityTimeoutSeconds
                    }),
                    { abortSignal: signal }
                );

                const message = response.Messages?.[0];

                if (!message) {
                    continue;
                }

                try {
                    if (!message.Body || !message.ReceiptHandle) {
                        throw new Error("Invalid SQS message");
                    }

                    const payload = JSON.parse(message.Body) as T;

                    await handler(payload);

                    // Acknowledge only after successful processing.
                    await this.client.send(
                        new DeleteMessageCommand({
                            QueueUrl: this.queueEndpoint,
                            ReceiptHandle: message.ReceiptHandle
                        }),
                        { abortSignal: signal }
                    );
                } catch (error) {
                    console.error("SQS message processing failed:", error);

                    // Do not delete the message.
                    // SQS makes it visible again after the visibility timeout.
                }
            } catch (error) {
                if (signal.aborted) {
                    break;
                }

                LogStream.getInstance().log(error, "SQS polling failed:", true);
                await sleep(1000, signal);
            }
        }
    }

    // Convert simple key-value pairs to SQS message attribute format
    private formatMessageAttributes(attributes: any) {
        const formatted: Record<string, { DataType: string, StringValue?: string } | { DataType: string, BinaryValue: Buffer}> = {};

        Object.entries(attributes).forEach(([key, value]) => {
            if (typeof value === 'number') {
                formatted[key] = { DataType: 'Number', StringValue: String(value) };
            } else if (typeof value === 'string') {
                formatted[key] = { DataType: 'String', StringValue: value };
            } else if (Buffer.isBuffer(value)) {
                formatted[key] = { DataType: 'Binary', BinaryValue: value };
            }
        });

        return formatted;
    }

    // Generate a unique deduplication ID based on message content
    private generateDeduplicationId(messageBody: any) {
        const content = typeof messageBody === 'string' ? messageBody : JSON.stringify(messageBody);
        return createHash('sha256').update(content).digest('hex');
    }
}