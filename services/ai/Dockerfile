FROM python:3.12-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.12.13 /uv /uvx /bin/

WORKDIR /app

COPY pyproject.toml uv.lock ./
COPY gen/python/pyproject.toml gen/python/pyproject.toml
COPY gen/python/v1 gen/python/v1
COPY services/ai/pyproject.toml services/ai/pyproject.toml

RUN uv sync \
    --package ai \
    --no-dev \
    --frozen \
    --no-editable \
    --no-install-project

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app/services/ai

COPY --from=builder /app/.venv /app/.venv
COPY services/ai/src ./src

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 50051

CMD ["python", "-m", "src.main"]
