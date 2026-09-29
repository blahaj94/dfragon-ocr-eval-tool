"""Plan only additional train characters; real rows and evaluation rows are immutable."""

import math
import random
import unicodedata
from collections import Counter

import regex

GROUPS = ("hangul", "special", "hiragana", "katakana", "hanja", "latin", "digit", "other")
GROUP_PATTERNS = [
    ("hangul", regex.compile(r"\p{Script=Hangul}")),
    ("hiragana", regex.compile(r"\p{Script=Hiragana}")),
    ("katakana", regex.compile(r"\p{Script=Katakana}")),
    ("hanja", regex.compile(r"\p{Script=Han}")),
    ("latin", regex.compile(r"\p{Script=Latin}")),
    ("digit", regex.compile(r"\p{Number}")),
    ("special", regex.compile(r"[\p{Punctuation}\p{Symbol}]")),
]


def character_group(char: str) -> str:
    # Match the UI/server's Unicode Script properties and priority, including
    # CP949 enclosed letters (symbols) and Roman numerals (Latin script).
    for group, pattern in GROUP_PATTERNS:
        if pattern.fullmatch(char):
            return group
    return "other"


def distribution(texts: list[str]) -> dict:
    frequencies = Counter(char for text in texts for char in unicodedata.normalize("NFC", text))
    counts = dict.fromkeys(GROUPS, 0)
    for char, count in frequencies.items():
        counts[character_group(char)] += count
    return {
        "images": len(texts),
        "nicknames": len({unicodedata.normalize("NFC", text) for text in texts}),
        "characters": sum(counts.values()),
        "groups": counts,
        "frequencies": [
            {"character": char, "count": count, "group": character_group(char)}
            for char, count in sorted(frequencies.items(), key=lambda item: (-item[1], item[0]))
        ],
    }


def validate_plan_options(value: dict) -> dict:
    if not isinstance(value, dict) or set(value.get("targets", {})) != set(GROUPS):
        raise ValueError("문자군별 목표를 확인해 주세요.")
    targets = value["targets"]
    for target in targets.values():
        if target is not None and (
            type(target) not in (int, float) or not math.isfinite(target) or not 0 <= target <= 100
        ):
            raise ValueError("목표 비율은 0~100 또는 빈 값이어야 합니다.")
    if sum(target or 0 for target in targets.values()) > 100 + 1e-8:
        raise ValueError("설정한 목표 비율의 합은 100%를 넘을 수 없습니다.")
    tolerance = value.get("tolerance")
    if (
        type(tolerance) not in (int, float)
        or not math.isfinite(tolerance)
        or not 0 <= tolerance <= 100
    ):
        raise ValueError("허용 오차(%p)를 0~100 사이로 입력해 주세요.")
    if type(value.get("maxImages")) is not int or not 1 <= value["maxImages"] <= 100_000:
        raise ValueError("합성 이미지 상한은 1~100000 사이여야 합니다.")
    if type(value.get("seed")) is not int or not 0 <= value["seed"] <= 2**32 - 1:
        raise ValueError("합성 seed는 0~4294967295 사이의 정수여야 합니다.")
    pools = value.get("characters")
    if not isinstance(pools, dict) or set(pools) != set(GROUPS):
        raise ValueError("합성 문자 목록을 확인해 주세요.")
    cleaned = {}
    for group, text in pools.items():
        if not isinstance(text, str) or len(text) > 20_000:
            raise ValueError("합성 문자 목록은 문자군당 20000자 이하입니다.")
        # Newlines and spaces separate pasted characters, never alter real labels.
        chars = list(
            dict.fromkeys(char for char in unicodedata.normalize("NFC", text) if not char.isspace())
        )
        if any(character_group(char) != group for char in chars):
            raise ValueError(f"{group}: 다른 문자군의 문자가 들어 있습니다.")
        if chars and targets[group] is None:
            raise ValueError(f"{group}: 합성할 문자군의 목표 비율을 입력해 주세요.")
        cleaned[group] = chars
    return {**value, "characters": cleaned}


def plan_supplement(
    rows: list[dict], value: dict, validate_nickname, cancelled=lambda: False
) -> dict:
    options = validate_plan_options(value)
    real_texts = [row["text"] for row in rows if row["split"] == "train"]
    real = distribution(real_texts)
    if not real["characters"]:
        raise ValueError("실제 train이 비어 있습니다.")
    pools = options["characters"]
    for chars in pools.values():
        for char in chars:
            result = validate_nickname(char)
            if not result.is_valid:
                raise ValueError(f"합성 문자 {char!r} (U+{ord(char):04X}): {result.reason}")
    fractions = {
        group: max(0, (options["targets"][group] - options["tolerance"]) / 100)
        for group in GROUPS
        if pools[group]
    }
    total = real["characters"]
    ceiling = total + options["maxImages"] * 12
    final_total = float(total)
    # Piecewise linear minimum: T = real + sum(max(0, lower[g] * T - real[g])).
    for _ in range(len(GROUPS) + 1):
        active = [
            group
            for group, fraction in fractions.items()
            if fraction * final_total > real["groups"][group] + 1e-9
        ]
        denominator = 1 - sum(fractions[group] for group in active)
        if denominator <= 1e-12:
            final_total = ceiling
            break
        next_total = min(
            ceiling, (total - sum(real["groups"][group] for group in active)) / denominator
        )
        if next_total <= final_total + 1e-8:
            break
        final_total = next_total
    remaining = {
        group: max(0, math.ceil(fraction * final_total - real["groups"][group] - 1e-8))
        for group, fraction in fractions.items()
    }
    requested = sum(remaining.values())
    usage = Counter({item["character"]: item["count"] for item in real["frequencies"]})
    blocked = {unicodedata.normalize("NFC", row["text"]) for row in rows}
    names = []
    rng = random.Random(options["seed"])
    attempts = 0
    while any(remaining.values()) and len(names) < options["maxImages"] and attempts < 200:
        if cancelled():
            raise InterruptedError("합성 준비를 취소했습니다.")
        target_length = rng.randint(2, 6)
        chars = []
        taken = Counter()
        size = 0
        for _ in range(target_length):
            candidates = [
                (group, char)
                for group, count in remaining.items()
                if count > taken[group]
                for char in pools[group]
                if char not in chars and size + len(char.encode("cp949")) <= 12
            ]
            if not candidates:
                break
            # Pick the most deficient group; rotate equally used characters with a seeded RNG.
            group = max(
                {group for group, _ in candidates},
                key=lambda group: (remaining[group] - taken[group], group),
            )
            least = min(usage[char] for candidate, char in candidates if candidate == group)
            char = rng.choice(
                [
                    char
                    for candidate, char in candidates
                    if candidate == group and usage[char] == least
                ]
            )
            chars.append(char)
            taken[group] += 1
            size += len(char.encode("cp949"))
        rng.shuffle(chars)
        text = "".join(chars)
        if not text or text in blocked or not validate_nickname(text).is_valid:
            attempts += 1
            continue
        attempts = 0
        blocked.add(text)
        names.append(text)
        usage.update(chars)
        for group, count in taken.items():
            remaining[group] -= count
    synthetic = distribution(names)
    final = distribution(real_texts + names)
    differences = {
        group: None
        if options["targets"][group] is None
        else 100 * final["groups"][group] / final["characters"] - options["targets"][group]
        for group in GROUPS
    }
    warnings = []
    if sum(remaining.values()):
        warnings.append(
            "이미지 상한 또는 중복 없는 닉네임 조합 한도로 부족분을 모두 만들지 못했습니다."
        )
    if any(
        delta is not None and abs(delta) > options["tolerance"] + 1e-8
        for delta in differences.values()
    ):
        warnings.append(
            "일부 문자군이 목표·허용 오차를 벗어납니다. 실제 자료를 유지하며 이 구성으로 실행할 수 있습니다."
        )
    return {
        "real": real,
        "synthetic": synthetic,
        "final": final,
        "differences": differences,
        "requestedCharacters": requested,
        "warnings": warnings,
        "nicknames": names,
    }
