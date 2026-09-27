"""Unicode edit distance, adapted from LDB PR #500 evaluation.py; see README attribution."""


def edit_distance(expected: str, actual: str) -> int:
    """Levenshtein distance by code point, without normalization or filtering."""
    previous = list(range(len(actual) + 1))

    for row, expected_char in enumerate(expected, 1):
        current = [row]

        for column, actual_char in enumerate(actual, 1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[column] + 1,
                    previous[column - 1] + (expected_char != actual_char),
                )
            )

        previous = current

    return previous[-1]
