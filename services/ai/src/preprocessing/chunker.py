from dataclasses import dataclass, field
from hashlib import sha256
from typing import Any

from preprocessing.text_normalizer import preprocess_text

@dataclass(frozen=True)
class DocumentChunk:
    document_id: str
    chunk_id: str
    text: str
    chunk_index: int
    metadata: dict[str, Any] = field(default_factory=dict)

def chunk_text(
    text: str,
    document_id: str,
    max_chars: int = 1000,
    overlap: int = 150,
    metadata: dict[str, Any] | None = None,
) -> list[DocumentChunk]:
    if not document_id.strip():
        raise ValueError("document_id must not be empty")
    if max_chars < 1:
        raise ValueError("max_chars must be positive")
    if overlap < 0 or overlap >= max_chars:
        raise ValueError("overlap must be non-negative and smaller than max_chars")

    text = preprocess_text(text)
    if not text:
        return []

    chunks: list[DocumentChunk] = []
    start = 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        if end < len(text):
            boundary = text.rfind(" ", start, end)
            if boundary > start:
                end = boundary

        chunk = text[start:end].strip()
        if chunk:
            index = len(chunks)
            chunk_id = sha256(f"{document_id}:{index}:{chunk}".encode("utf-8")).hexdigest()
            chunks.append(
                DocumentChunk(
                    document_id=document_id,
                    chunk_id=chunk_id,
                    text=chunk,
                    chunk_index=index,
                    metadata=dict(metadata or {}),
                )
            )

        if end >= len(text):
            break
        start = max(start + 1, end - overlap)
        next_boundary = text.find(" ", start, end)
        if next_boundary >= 0:
            start = next_boundary + 1
        while start < len(text) and text[start].isspace():
            start += 1

    return chunks