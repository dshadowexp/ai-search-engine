import { Pool, PoolClient } from "pg";
import { Database, Queryable } from "./database.ts";

async function queryRows<R>(
    target: Pool | PoolClient,
    sql: string,
    params: unknown[],
): Promise<R[]> {
    const result = await target.query(sql, params);
    return result.rows as R[];
}

export class PgDatabase implements Database {
    constructor(
        connectionString: string,
        private readonly pool = new Pool({ connectionString }),
    ) {}

    query<R = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<R[]> {
        return queryRows<R>(this.pool, sql, params);
    }

    async transaction<R>(work: (tx: Queryable) => Promise<R>): Promise<R> {
        const client = await this.pool.connect();
        const tx: Queryable = {
            query: (sql, params = []) => queryRows(client, sql, params),
        };

        try {
            await client.query("BEGIN");
            const result = await work(tx);
            await client.query("COMMIT");
            return result;
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }

    close(): Promise<void> {
        return this.pool.end();
    }
}