from dataclasses import dataclass, field
from hashlib import sha256
from typing import Any

# @dataclass(frozen=True)
# class DocumentChunk:
#     document_id: str
#     chunk_id: str
#     text: str
#     chunk_index: int
#     metadata: dict[str, Any] = field(default_factory=dict)

# def chunk_text(
#     text: str,
#     document_id: str,
#     max_chars: int = 1000,
#     overlap: int = 150,
#     metadata: dict[str, Any] | None = None,
# ) -> list[DocumentChunk]:
#     if not document_id.strip():
#         raise ValueError("document_id must not be empty")
#     if max_chars < 1:
#         raise ValueError("max_chars must be positive")
#     if overlap < 0 or overlap >= max_chars:
#         raise ValueError("overlap must be non-negative and smaller than max_chars")

#     text = preprocess_text(text)
#     if not text:
#         return []

#     chunks: list[DocumentChunk] = []
#     start = 0
#     while start < len(text):
#         end = min(start + max_chars, len(text))
#         if end < len(text):
#             boundary = text.rfind(" ", start, end)
#             if boundary > start:
#                 end = boundary

#         chunk = text[start:end].strip()
#         if chunk:
#             index = len(chunks)
#             chunk_id = sha256(f"{document_id}:{index}:{chunk}".encode("utf-8")).hexdigest()
#             chunks.append(
#                 DocumentChunk(
#                     document_id=document_id,
#                     chunk_id=chunk_id,
#                     text=chunk,
#                     chunk_index=index,
#                     metadata=dict(metadata or {}),
#                 )
#             )

#         if end >= len(text):
#             break
#         start = max(start + 1, end - overlap)
#         next_boundary = text.find(" ", start, end)
#         if next_boundary >= 0:
#             start = next_boundary + 1
#         while start < len(text) and text[start].isspace():
#             start += 1

#     return chunks

# import uuid

from ai.models.indexed_document import IndexedDocument
from ai.models.chunks import DocumentChunk
from ai.pipeline.normalizer import normalize_text


SEPARATORS = ["\n\n", "\n", ". ", " "]


def split_text(text: str, size: int) -> list[str]:

    if len(text) <= size:
        return [text]

    for separator in SEPARATORS:

        parts = text.split(separator)

        if len(parts) == 1:
            continue

        chunks = []
        current = ""

        for part in parts:

            candidate = (
                f"{current}{separator}{part}"
                if current else part
            )

            if len(candidate) <= size:
                current = candidate
                continue

            if current:
                chunks.append(current)

            current = part

        if current:
            chunks.append(current)

        if all(len(chunk) <= size for chunk in chunks):
            return chunks

    # Hard split as a final fallback.
    return [
        text[i:i + size]
        for i in range(0, len(text), size)
    ]


def chunk_document(
    document: IndexedDocument,
    chunk_size: int = 1000,
    overlap: int = 150,
    metadata: dict[str, Any] | None = None,
) -> list[DocumentChunk]:
    if not document.document_id.strip():
            raise ValueError("document_id must not be empty")
    if chunk_size < 1:
            raise ValueError("max_chars must be positive")
    if overlap < 0 or overlap >= chunk_size:
        raise ValueError("overlap must be non-negative and smaller than max_chars")

    text = normalize_text(document.content)

    chunks: list[DocumentChunk] = []
    position = 0

    while position < len(text):

        end = min(position + chunk_size, len(text))

        raw_chunk = text[position:end]

        chunk_content = raw_chunk.strip()

        if chunk_content:
            index = len(chunks)
            chunk_id = sha256(f"{document.document_id}:{index}:{chunk_content}".encode("utf-8")).hexdigest()
#             
            chunks.append(
                DocumentChunk(
                    chunk_id=chunk_id,
                    document_id=document.document_id,
                    content=chunk_content,
                    chunk_index=index,
                    start_offset=position,
                    end_offset=end,
                )
            )

        if end == len(text):
            break

        position = max(position + 1, end - overlap)
        next_boundary = text.find(" ", position, end)
        if (next_boundary >= 0):
            position = next_boundary + 1
        while position < len(text) and text[position].isspace():
            position += 1

    return chunks