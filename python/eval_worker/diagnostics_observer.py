"""Observe the selected real preprocessing call; previews never become model inputs."""

import base64
import hashlib
import io
import json
import sys

import numpy as np
from PIL import Image


def input_fingerprint(array: np.ndarray) -> str:
    header = json.dumps(
        {"dtype": array.dtype.str, "shape": list(array.shape)},
        sort_keys=True,
        separators=(",", ":"),
    ).encode("ascii")
    return hashlib.sha256(header + b"\0" + array.tobytes(order="C")).hexdigest()


def observe_model_input(adapter, raw: bytes) -> tuple[object, dict[str, np.ndarray]]:
    """Read locals at the actual function's return, without replacing its implementation."""
    target = adapter.tensor_from_png.__code__
    observed = []
    previous = sys.getprofile()

    def profile(frame, event, result) -> None:
        if callable(previous):
            previous(frame, event, result)
        if event != "return" or frame.f_code is not target or result is None:
            return
        names = ("rgb", "inverted", "normalized", "output")
        if any(not isinstance(frame.f_locals.get(name), np.ndarray) for name in names):
            raise ValueError("Selected preprocessing does not expose the supported actual stages.")
        observed.append({name: frame.f_locals[name].copy() for name in names})

    try:
        sys.setprofile(profile)
        model_input = adapter.model_input(raw)
    finally:
        sys.setprofile(previous)
    if len(observed) != 1:
        raise ValueError("Diagnostics require exactly one real preprocessing call.")
    arrays = observed[0]
    actual = model_input.numpy().copy()
    rgb, inverted, normalized, output = (arrays[name] for name in arrays)
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ValueError("Observed RGB layout is unsupported.")
    height, width = rgb.shape[:2]
    if (
        inverted.shape != (height, width)
        or inverted.dtype != np.uint8
        or normalized.shape != (height, width)
        or normalized.dtype != np.float32
        or output.ndim != 3
        or output.shape[0] != 3
        or output.shape[1] < height
        or output.shape[2] < width
        or output.dtype != np.float32
        or actual.shape != (1, *output.shape)
        or actual.dtype != output.dtype
        or not np.array_equal(actual[0], output)
        or any(not np.isfinite(array).all() for array in [*arrays.values(), actual])
    ):
        raise ValueError("Observed preprocessing stages differ from the actual model input.")
    arrays["model-input"] = actual
    return model_input, arrays


def png_url(pixels: np.ndarray) -> str:
    buffer = io.BytesIO()
    Image.fromarray(pixels).save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def preview_stages(raw: bytes, arrays: dict[str, np.ndarray]) -> list[dict]:
    """Serialize copies of observed values; range mapping is only for human display."""
    height, width = arrays["rgb"].shape[:2]
    stages = []
    definitions = (
        ("original", "원본 PNG", "rgb", "실제 함수가 디코딩한 RGB 배열. 공간 변환 없음."),
        ("inverted-grayscale", "반전 회색조", "inverted", "실제 회색조·반전 계산의 uint8 결과."),
        ("normalized", "정규화", "normalized", "원본 크기에서 계산된 실제 float32 값."),
        ("padded", "패딩", "output", "정규화 후 오른쪽·아래에 패딩한 실제 CHW 배열."),
        ("model-input", "최종 모델 입력", "model-input", "모델에 전달하는 실제 NCHW Paddle 텐서."),
    )
    for stage_id, name, key, description in definitions:
        array = arrays[key]
        minimum, maximum = float(array.min()), float(array.max())
        if stage_id == "original":
            preview = "data:image/png;base64," + base64.b64encode(raw).decode("ascii")
            image_height, image_width = height, width
            note = "원본 PNG 그대로 표시. shape·dtype·범위는 실제 디코딩된 RGB 배열 기준."
        else:
            plane = array if array.ndim == 2 else array[0] if array.ndim == 3 else array[0, 0]
            image_height, image_width = plane.shape
            if plane.dtype == np.uint8:
                pixels = plane.copy()
                note = "실제 uint8 값을 그대로 표시. 미리보기는 모델 입력으로 사용하지 않음."
            else:
                display = plane.astype(np.float64, copy=True)
                pixels = (
                    np.zeros(display.shape, dtype=np.uint8)
                    if maximum == minimum
                    else np.rint((display - minimum) / (maximum - minimum) * 255)
                    .clip(0, 255)
                    .astype(np.uint8)
                )
                note = (
                    f"화면용 복사본: 실제 범위 [{minimum:g}, {maximum:g}]를 0–255로 표시"
                    + (" (상수 배열은 0)." if maximum == minimum else ".")
                    + (" 첫 번째 채널 표시." if array.ndim > 2 else "")
                    + " 이 변환은 모델 입력에 적용하지 않음."
                )
            preview = png_url(pixels)
        stages.append(
            {
                "id": stage_id,
                "name": name,
                "description": description,
                "previewUrl": preview,
                "previewNote": note,
                "imageWidth": int(image_width),
                "imageHeight": int(image_height),
                "shape": list(array.shape),
                "dtype": str(array.dtype),
                "minimum": minimum,
                "maximum": maximum,
                "contentBounds": (
                    {"x": 0, "y": 0, "width": width, "height": height}
                    if stage_id in {"padded", "model-input"}
                    else None
                ),
            }
        )
    return stages
