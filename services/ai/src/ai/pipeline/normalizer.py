import unicodedata

from .cleaner import clean_text


def normalize_text(text: str) -> str:
    """Normalize Unicode and collapse whitespace without changing letter case."""
    return " ".join(unicodedata.normalize("NFKC", text).split())

# def normalize_text(text: str) -> str:

#     text = text.replace("\x00", "")

#     text = text.replace("\r\n", "\n")
#     text = text.replace("\r", "\n")

#     # Normalize horizontal whitespace.
#     text = re.sub(r"[ \t]+", " ", text)

#     # Normalize excessive blank lines.
#     text = re.sub(r"\n{3,}", "\n\n", text)

#     return text.strip()