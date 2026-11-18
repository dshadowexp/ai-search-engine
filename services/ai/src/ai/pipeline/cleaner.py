import html
import re

_CONTROL_CHARACTERS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

def clean_text(text: str) -> str:
    """Unescape HTML entities and remove control characters from extracted text."""
    return _CONTROL_CHARACTERS.sub("", html.unescape(text))