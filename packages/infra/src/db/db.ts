export interface Queryable {
    query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<R[]>;
}

export interface Database extends Queryable {
    /** Runs `work` in a transaction: commits on success, rolls back on throw. */
    transaction<R>(work: (tx: Queryable) => Promise<R>): Promise<R>;
    close(): Promise<void>;
}