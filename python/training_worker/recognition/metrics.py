"""Recognition metrics, adapted from LDB PR #500 evaluation.py; see README attribution."""

from collections.abc import Sequence

from .distance import edit_distance


def recognition_metrics(pairs: Sequence[tuple[str, str]]) -> dict[str, int | float]:
    """Aggregate exact match and CER; reject absent evidence and empty references."""
    if not pairs or any(not expected for expected, _ in pairs):
        raise ValueError("Metrics require samples with nonempty reference text.")

    return {
        "samples": len(pairs),
        "exact_match": sum(expected == actual for expected, actual in pairs) / len(pairs),
        "cer": sum(edit_distance(expected, actual) for expected, actual in pairs)
        / sum(len(expected) for expected, _ in pairs),
    }
