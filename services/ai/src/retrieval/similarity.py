from collections.abc import Sequence
from math import fsum, sqrt


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    if len(left) == 0 or len(right) == 0:
        raise ValueError("vectors must not be empty")
    if len(left) != len(right):
        raise ValueError("vectors must have the same dimensions")

    dot = fsum(a * b for a, b in zip(left, right))
    left_norm = sqrt(fsum(value * value for value in left))
    right_norm = sqrt(fsum(value * value for value in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return max(-1.0, min(1.0, dot / (left_norm * right_norm)))