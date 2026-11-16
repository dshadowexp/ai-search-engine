import unicodedata

from preprocessing.cleaner import clean_text


def normalize_text(text: str) -> str:
    """Normalize Unicode and collapse whitespace without changing letter case."""
    return " ".join(unicodedata.normalize("NFKC", text).split())


def preprocess_text(text: str) -> str:
    return normalize_text(clean_text(text))