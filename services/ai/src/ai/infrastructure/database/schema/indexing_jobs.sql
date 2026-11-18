CREATE TABLE IF NOT EXISTS indexing_jobs (
    idempotency_key TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    document_version TEXT NOT NULL,

    status TEXT NOT NULL CHECK (
        status IN ('processing', 'completed', 'failed')
    ),

    lease_token UUID,
    lease_expires_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_indexing_jobs_status
ON indexing_jobs(status, lease_expires_at);
