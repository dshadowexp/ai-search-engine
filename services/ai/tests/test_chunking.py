import pytest

from src.preprocessing.chunker import chunk_text


def test_chunk_text_normalizes_and_splits_with_overlap():
    chunks = chunk_text(
        "  Alpha   beta &amp; gamma delta epsilon  ",
        document_id="doc-1",
        max_chars=14,
        overlap=4,
        metadata={"url": "https://example.com"},
    )

    assert len(chunks) > 1
    assert all(len(chunk.text) <= 14 for chunk in chunks)
    assert chunks[0].text == "Alpha beta &"
    assert chunks[1].text.startswith("& gamma")
    assert [chunk.chunk_index for chunk in chunks] == list(range(len(chunks)))
    assert len({chunk.chunk_id for chunk in chunks}) == len(chunks)
    assert all(chunk.metadata == {"url": "https://example.com"} for chunk in chunks)


def test_chunk_text_returns_empty_for_empty_text_and_rejects_bad_limits():
    assert chunk_text(" \n ", document_id="doc-1") == []

    with pytest.raises(ValueError, match="max_chars"):
        chunk_text("text", document_id="doc-1", max_chars=0)
    with pytest.raises(ValueError, match="overlap"):
        chunk_text("text", document_id="doc-1", max_chars=10, overlap=10)