"""Append explicitly selected characters and preserve the pinned model's class meaning."""

import unicodedata
from pathlib import Path


def extend_characters(original: list[str], additions: str) -> list[str]:
    if not isinstance(additions, str) or len(additions) > 20_000:
        raise ValueError("추가 문자 목록은 20000자 이하의 문자열이어야 합니다.")
    result = list(original)
    seen = set(result) | {" "}
    for char in unicodedata.normalize("NFC", additions):
        if char.isspace():
            continue
        if unicodedata.category(char) in {"Cc", "Cf", "Cs"} or char == "\ufeff":
            raise ValueError("제어·비표시 문자는 모델 사전에 추가할 수 없습니다.")
        if char not in seen:
            result.append(char)
            seen.add(char)
    return result


def write_run_dictionary(source: Path, output: Path, additions: str) -> list[str]:
    original = source.read_text(encoding="utf-8").splitlines()
    extended = extend_characters(original, additions)
    with output.open("xb") as stream:
        stream.write(
            source.read_bytes()
            if extended == original
            else ("\n".join(extended) + "\n").encode("utf-8")
        )
    return extended[len(original) :]


def expand_state_arrays(
    state: dict, initialized: dict, original: list[str], extended: list[str]
) -> dict:
    """Copy CTC/NRTR classes by semantic index, including implicit space and reserved tokens.

    This allowlist is specific to the pinned Korean PP-OCRv5 MultiHead with NRTR.
    Unknown parameter changes fail; no partial or permissive state loading is used.
    """
    if len(extended) <= len(original) or extended[: len(original)] != original:
        raise ValueError("문자 확장은 기존 사전 순서를 유지하며 뒤에만 추가해야 합니다.")
    if len(set(extended)) != len(extended) or " " in extended:
        raise ValueError("사전의 중복·공백 문자를 확인해 주세요.")
    axes = {
        "head.ctc_head.fc.weight": (1, 1, 0),
        "head.ctc_head.fc.bias": (0, 1, 0),
        "head.gtc_head.embedding.embedding.weight": (0, 4, 1),
        "head.gtc_head.tgt_word_prj.weight": (1, 4, 1),
    }
    if state.keys() != initialized.keys() or not axes.keys() <= state.keys():
        raise ValueError("문자 확장 모델의 parameter 이름이 일치하지 않습니다.")
    result = {}
    for name, old in state.items():
        new = initialized[name]
        if name not in axes:
            if old.shape != new.shape:
                raise ValueError(f"문자 출력층 밖의 shape 변경: {name}")
            result[name] = old
            continue
        axis, prefix, trailing = axes[name]
        old_classes = prefix + len(original) + 1 + trailing
        new_classes = prefix + len(extended) + 1 + trailing
        expected = list(old.shape)
        expected[axis] = new_classes
        if old.shape[axis] != old_classes or list(new.shape) != expected or old.dtype != new.dtype:
            raise ValueError(f"지원하지 않는 문자 출력층 shape/dtype: {name}")
        destination = list(range(prefix + len(original))) + list(
            range(prefix + len(extended), new_classes)
        )
        copied = new.copy()
        selector = [slice(None)] * old.ndim
        selector[axis] = destination
        copied[tuple(selector)] = old
        result[name] = copied
    return result
