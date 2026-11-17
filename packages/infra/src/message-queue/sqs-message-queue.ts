import { sleep } from "@search/core";
import { createHash } from "node:crypto";
import {
    ChangeMessageVisibilityCommand,
    DeleteMessageBatchCommand,
    ReceiveMessageCommand,
    SendMessageCommand,
    SQSClient,
    type Message as SqsMessage,
    type SendMessageCommandInput,
} from "@aws-sdk/client-sqs";
import { createSqsClient } from "../aws/aws-client.ts";
import { LogStream } from "../logging/log-stream.ts";
import {
    decodeQueueMessage,
    encodeQueueMessage,
    type ConsumeOptions,
    type MessageQueue,
    type MessageSchema,
    type QueueConsumer,
} from "./message-queue.ts";

type MessageAttribute = string | number | Uint8Array;
type MessageGroupId<T> = string | ((message: T) => string);

export interface SqsMessageQueueOptions<T> {
    schema: MessageSchema<T>;
    region?: string;
    endpoint?: string;
    delaySeconds?: number;
    attributes?: Record<string, MessageAttribute>;
    /** Required for FIFO queues; a function can preserve per-document ordering. */
    messageGroupId?: MessageGroupId<T>;
    /** FIFO queues default to a SHA-256 digest of the serialized message. */
    deduplicationId?: (message: T) => string;
}

interface AcknowledgedMessage {
    Id: string;
    ReceiptHandle: string;
}

const MAX_BATCH_SIZE = 10;
const MAX_WAIT_TIME_SECONDS = 20;
const MAX_VISIBILITY_TIMEOUT_SECONDS = 43_200;
const MAX_DELAY_SECONDS = 900;

export class SqsMessageQueue<T> implements MessageQueue<T> {
    private readonly client: SQSClient;
    private readonly ownsClient: boolean;
    private readonly options: SqsMessageQueueOptions<T>;
    private readonly queueUrl: string;
    private readonly fifo: boolean;
    private readonly messageAttributes: NonNullable<SendMessageCommandInput["MessageAttributes"]> | undefined;

    constructor(queueUrl: string, options: SqsMessageQueueOptions<T>, client?: SQSClient) {
        if (!queueUrl.trim()) throw new TypeError("queueUrl must not be empty");
        if (!options?.schema || typeof options.schema.parse !== "function") {
            throw new TypeError("SQS queue requires a runtime message schema");
        }

        const queueName = new URL(queueUrl).pathname.split("/").at(-1) ?? "";
        this.fifo = queueName.endsWith(".fifo");
        if (this.fifo && !options.messageGroupId) {
            throw new TypeError("FIFO queues require messageGroupId");
        }
        if (!this.fifo && (options.messageGroupId || options.deduplicationId)) {
            throw new TypeError("messageGroupId and deduplicationId are only valid for FIFO queues");
        }
        if (this.fifo && options.delaySeconds !== undefined) {
            throw new RangeError("FIFO queues do not support per-message delay");
        }
        if (options.delaySeconds !== undefined && (!Number.isInteger(options.delaySeconds) || options.delaySeconds < 0 || options.delaySeconds > MAX_DELAY_SECONDS)) {
            throw new RangeError(`delaySeconds must be an integer between 0 and ${MAX_DELAY_SECONDS}`);
        }

        this.queueUrl = queueUrl;
        this.options = options;
        this.ownsClient = client === undefined;
        this.messageAttributes = options.attributes ? this.formatMessageAttributes(options.attributes) : undefined;
        this.client = client ?? createSqsClient({
            region: this.options.region?.trim() || process.env.AWS_REGION?.trim() || "us-east-1",
            forcePathStyle: false,
            requestTimeoutMs: 30_000,
            connectionTimeoutMs: 5_000,
            maxAttempts: 3,
            ...(this.options.endpoint ? { endpoint: this.options.endpoint } : {}),
        });
    }

    close(): void {
        if (this.ownsClient) this.client.destroy();
    }

    async publish(messageBody: T): Promise<void> {
        const { message, body } = encodeQueueMessage(messageBody, this.options.schema);
        const params: SendMessageCommandInput = {
            QueueUrl: this.queueUrl,
            MessageBody: body,
            ...(this.options.delaySeconds !== undefined ? { DelaySeconds: this.options.delaySeconds } : {}),
            ...(this.messageAttributes ? { MessageAttributes: this.messageAttributes } : {}),
        };

        if (this.fifo) {
            const groupId = this.resolveValue(this.options.messageGroupId!, message);
            if (typeof groupId !== "string" || groupId.length < 1 || groupId.length > 128) {
                throw new RangeError("FIFO messageGroupId must contain between 1 and 128 characters");
            }

            const deduplicationId = this.options.deduplicationId
                ? this.options.deduplicationId(message)
                : createHash("sha256").update(body).digest("hex");
            if (typeof deduplicationId !== "string" || deduplicationId.length < 1 || deduplicationId.length > 128) {
                throw new RangeError("FIFO deduplicationId must contain between 1 and 128 characters");
            }

            params.MessageGroupId = groupId;
            params.MessageDeduplicationId = deduplicationId;
        }

        await this.client.send(new SendMessageCommand(params));
    }

    consume(
        handler: (message: T) => Promise<void>,
        options: ConsumeOptions = {},
    ): QueueConsumer {
        if (typeof handler !== "function") throw new TypeError("handler must be a function");

        const settings = this.resolveConsumeOptions(options);
        const controller = new AbortController();
        const workers = Array.from(
            { length: settings.concurrency },
            () => this.runWorker(handler, controller.signal, settings),
        );
        let stopping: Promise<void> | undefined;

        return {
            stop: () => {
                if (!stopping) {
                    controller.abort();
                    stopping = Promise.all(workers).then(() => undefined);
                }
                return stopping;
            },
        };
    }

    //----------------------------------- Private
    private async runWorker(
        handler: (message: T) => Promise<void>,
        signal: AbortSignal,
        options: Required<ConsumeOptions>,
    ): Promise<void> {
        while (!signal.aborted) {
            try {
                const response = await this.client.send(
                    new ReceiveMessageCommand({
                        QueueUrl: this.queueUrl,
                        MaxNumberOfMessages: options.batchSize,
                        WaitTimeSeconds: options.waitTimeSeconds,
                        VisibilityTimeout: options.visibilityTimeoutSeconds,
                        ...(this.fifo ? { MessageSystemAttributeNames: ["MessageGroupId"] } : {}),
                    }),
                    { abortSignal: signal },
                );

                const messages = response.Messages ?? [];
                if (messages.length) {
                    await this.processBatch(messages, handler, options.visibilityTimeoutSeconds);
                }
            } catch (error) {
                if (signal.aborted) break;
                this.logError("SQS polling or acknowledgement failed", error);
                await sleep(1_000, signal);
            }
        }
    }

    private async processBatch(
        messages: SqsMessage[],
        handler: (message: T) => Promise<void>,
        visibilityTimeoutSeconds: number,
    ): Promise<void> {
        const acknowledged: AcknowledgedMessage[] = [];

        if (this.fifo) {
            // Preserve message order and stop after the first failed FIFO item.
            for (const [index, message] of messages.entries()) {
                const done = await this.processMessage(message, String(index), handler, visibilityTimeoutSeconds);
                if (!done) break;
                acknowledged.push(done);
            }
        } else {
            const results = await Promise.all(messages.map((message, index) =>
                this.processMessage(message, String(index), handler, visibilityTimeoutSeconds),
            ));
            acknowledged.push(...results.filter((result): result is AcknowledgedMessage => result !== undefined));
        }

        if (!acknowledged.length) return;

        const response = await this.client.send(new DeleteMessageBatchCommand({
            QueueUrl: this.queueUrl,
            Entries: acknowledged,
        }));
        for (const failure of response.Failed ?? []) {
            this.logError(`Failed to acknowledge SQS message ${failure.Id ?? "(unknown)"}`, failure);
        }

    }

    private async processMessage(
        message: SqsMessage,
        id: string,
        handler: (message: T) => Promise<void>,
        visibilityTimeoutSeconds: number,
    ): Promise<AcknowledgedMessage | undefined> {
        if (typeof message.Body !== "string" || !message.ReceiptHandle) {
            this.logError(`Received an invalid SQS message ${message.MessageId ?? "(unknown)"}`, "Missing body or receipt handle");
            return undefined;
        }

        const stopHeartbeat = this.startVisibilityHeartbeat(message.ReceiptHandle, visibilityTimeoutSeconds);
        try {
            const payload = decodeQueueMessage(message.Body, this.options.schema);
            await handler(payload);
            return { Id: id, ReceiptHandle: message.ReceiptHandle };
        } catch (error) {
            // Leave failures unacknowledged for SQS retry / redrive policy.
            this.logError(`SQS message ${message.MessageId ?? "(unknown)"} was not processed`, error);
            return undefined;
        } finally {
            stopHeartbeat();
        }
    }

    private startVisibilityHeartbeat(receiptHandle: string, visibilityTimeoutSeconds: number): () => void {
        let renewing = false;
        const intervalMs = Math.max(100, Math.floor(visibilityTimeoutSeconds * 1_000 / 2));
        const timer = setInterval(() => {
            if (renewing) return;
            renewing = true;
            void this.client.send(new ChangeMessageVisibilityCommand({
                QueueUrl: this.queueUrl,
                ReceiptHandle: receiptHandle,
                VisibilityTimeout: visibilityTimeoutSeconds,
            })).catch((error: unknown) => {
                this.logError("Failed to extend SQS message visibility", error);
            }).finally(() => {
                renewing = false;
            });
        }, intervalMs);
        timer.unref();
        return () => clearInterval(timer);
    }

    private resolveConsumeOptions(options: ConsumeOptions): Required<ConsumeOptions> {
        const resolved: Required<ConsumeOptions> = {
            concurrency: options.concurrency ?? 1,
            batchSize: options.batchSize ?? MAX_BATCH_SIZE,
            visibilityTimeoutSeconds: options.visibilityTimeoutSeconds ?? 120,
            waitTimeSeconds: options.waitTimeSeconds ?? MAX_WAIT_TIME_SECONDS,
        };

        if (!Number.isInteger(resolved.concurrency) || resolved.concurrency < 1) {
            throw new RangeError("concurrency must be a positive integer");
        }
        if (!Number.isInteger(resolved.batchSize) || resolved.batchSize < 1 || resolved.batchSize > MAX_BATCH_SIZE) {
            throw new RangeError(`batchSize must be an integer between 1 and ${MAX_BATCH_SIZE}`);
        }
        if (!Number.isInteger(resolved.visibilityTimeoutSeconds) || resolved.visibilityTimeoutSeconds < 1 || resolved.visibilityTimeoutSeconds > MAX_VISIBILITY_TIMEOUT_SECONDS) {
            throw new RangeError(`visibilityTimeoutSeconds must be an integer between 1 and ${MAX_VISIBILITY_TIMEOUT_SECONDS}`);
        }
        if (!Number.isInteger(resolved.waitTimeSeconds) || resolved.waitTimeSeconds < 0 || resolved.waitTimeSeconds > MAX_WAIT_TIME_SECONDS) {
            throw new RangeError(`waitTimeSeconds must be an integer between 0 and ${MAX_WAIT_TIME_SECONDS}`);
        }

        return resolved;
    }

    private resolveValue<TMessage>(value: string | ((message: TMessage) => string), message: TMessage): string {
        return typeof value === "function" ? value(message) : value;
    }

    private formatMessageAttributes(
        attributes: Record<string, MessageAttribute>,
    ): NonNullable<SendMessageCommandInput["MessageAttributes"]> {
        if (Object.keys(attributes).length > 10) {
            throw new RangeError("SQS supports at most 10 message attributes");
        }

        const formatted: NonNullable<SendMessageCommandInput["MessageAttributes"]> = {};
        for (const [key, value] of Object.entries(attributes)) {
            if (typeof value === "number") {
                if (!Number.isFinite(value)) throw new TypeError(`SQS message attribute ${key} must be finite`);
                formatted[key] = { DataType: "Number", StringValue: String(value) };
            } else if (typeof value === "string") {
                formatted[key] = { DataType: "String", StringValue: value };
            } else if (value instanceof Uint8Array) {
                formatted[key] = { DataType: "Binary", BinaryValue: value };
            } else {
                throw new TypeError(`Unsupported SQS message attribute value for ${key}`);
            }
        }

        return formatted;
    }

    private logError(message: string, error: unknown): void {
        LogStream.getInstance().log({
            message,
            error: error instanceof Error ? error.message : String(error),
        }, "SQS message queue", true);
    }
}
