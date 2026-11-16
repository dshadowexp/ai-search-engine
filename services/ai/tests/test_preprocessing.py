from src.preprocessing.cleaner import clean_text
from src.preprocessing.text_normalizer import normalize_text, preprocess_text


def test_clean_text_unescapes_entities_and_removes_control_characters():
    assert clean_text("A&nbsp;B\x00&amp;C") == "A\u00a0B&C"


def test_normalization_applies_unicode_compatibility_and_collapses_whitespace():
    assert normalize_text("  Ｃafé\tguide\n") == "Café guide"
    assert preprocess_text("A&nbsp;B") == "A B"
