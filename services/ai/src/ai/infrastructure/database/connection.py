import asyncpg

from ai.config import Settings


pool: asyncpg.Pool | None = None


async def connect():
    global pool

    pool = await asyncpg.create_pool(
        dsn=Settings.DATABASE_URL,
        min_size=2,
        max_size=10,
    )


async def disconnect():
    global pool

    if pool:
        await pool.close()
        pool = None


def get_pool() -> asyncpg.Pool:
    if pool is None:
        raise RuntimeError("Database is not connected")

    return pool