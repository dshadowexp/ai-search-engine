import hashlib
import uuid

import asyncpg


def create_idempotency_key(
    document_id: str,
    document_version: str,
) -> str:
    value = f"{document_id}:{document_version}"

    return hashlib.sha256(
        value.encode("utf-8")
    ).hexdigest()


class DeduplicationStore:

    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool

    async def claim(
        self,
        document_id: str,
        document_version: str,
        lease_seconds: int = 600,
    ):
        key = create_idempotency_key(
            document_id,
            document_version,
        )

        token = uuid.uuid4()

        row = await self.pool.fetchrow(
            """
            INSERT INTO indexing_jobs (
                idempotency_key,
                document_id,
                document_version,
                status,
                lease_token,
                lease_expires_at
            )
            VALUES (
                $1, $2, $3, 'processing', $4,
                NOW() + ($5 * INTERVAL '1 second')
            )
            ON CONFLICT (idempotency_key)
            DO UPDATE SET
                status = 'processing',
                lease_token = EXCLUDED.lease_token,
                lease_expires_at = EXCLUDED.lease_expires_at,
                updated_at = NOW()
            WHERE
                indexing_jobs.status = 'failed'
                OR (
                    indexing_jobs.status = 'processing'
                    AND indexing_jobs.lease_expires_at < NOW()
                )
            RETURNING lease_token
            """,
            key,
            document_id,
            document_version,
            token,
            lease_seconds,
        )

        if row:
            return {
                "status": "claimed",
                "key": key,
                "token": token,
            }

        existing = await self.pool.fetchrow(
            """
            SELECT status
            FROM indexing_jobs
            WHERE idempotency_key = $1
            """,
            key,
        )

        if existing and existing["status"] == "completed":
            return {
                "status": "completed",
                "key": key,
                "token": None,
            }

        return {
            "status": "busy",
            "key": key,
            "token": None,
        }

    async def renew(
        self,
        key: str,
        token: uuid.UUID,
        lease_seconds: int = 600,
    ) -> bool:

        result = await self.pool.execute(
            """
            UPDATE indexing_jobs
            SET
                lease_expires_at =
                    NOW() + ($3 * INTERVAL '1 second'),
                updated_at = NOW()
            WHERE
                idempotency_key = $1
                AND lease_token = $2
                AND status = 'processing'
            """,
            key,
            token,
            lease_seconds,
        )

        return result == "UPDATE 1"

    async def complete(
        self,
        key: str,
        token: uuid.UUID,
    ) -> bool:

        result = await self.pool.execute(
            """
            UPDATE indexing_jobs
            SET
                status = 'completed',
                completed_at = NOW(),
                updated_at = NOW(),
                lease_token = NULL,
                lease_expires_at = NULL
            WHERE
                idempotency_key = $1
                AND lease_token = $2
                AND status = 'processing'
            """,
            key,
            token,
        )

        return result == "UPDATE 1"

    async def fail(
        self,
        key: str,
        token: uuid.UUID,
    ) -> bool:

        result = await self.pool.execute(
            """
            UPDATE indexing_jobs
            SET
                status = 'failed',
                updated_at = NOW(),
                lease_token = NULL,
                lease_expires_at = NULL
            WHERE
                idempotency_key = $1
                AND lease_token = $2
                AND status = 'processing'
            """,
            key,
            token,
        )

        return result == "UPDATE 1"
