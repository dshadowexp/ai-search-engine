import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { S3BlobStore } from "./blob-store.ts";

test("S3BlobStore uses path-style requests with a custom endpoint", async () => {
    let requestPath: string | undefined;
    const server = createServer((request, response) => {
        requestPath = request.url;
        response.statusCode = 200;
        response.setHeader("ETag", '"test-etag"');
        response.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const previousCredentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
    process.env.AWS_ACCESS_KEY_ID = "test-access-key";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";

    const store = new S3BlobStore({
        region: "us-east-1",
        bucket: "crawler",
        endpoint: `http://127.0.0.1:${address.port}`,
        ownsClient: true,
    });

    try {
        await store.put("crawled/document.json.gz", "test");
        assert.ok(requestPath);
        assert.equal(
            new URL(requestPath, "http://localhost").pathname,
            "/crawler/crawled/document.json.gz",
        );
    } finally {
        await store.close();
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });

        if (previousCredentials.accessKeyId === undefined) {
            delete process.env.AWS_ACCESS_KEY_ID;
        } else {
            process.env.AWS_ACCESS_KEY_ID = previousCredentials.accessKeyId;
        }
        if (previousCredentials.secretAccessKey === undefined) {
            delete process.env.AWS_SECRET_ACCESS_KEY;
        } else {
            process.env.AWS_SECRET_ACCESS_KEY = previousCredentials.secretAccessKey;
        }
    }
});
