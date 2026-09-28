"""Composite local-font RGBA renders onto explicit opaque crop backgrounds."""

import importlib.metadata
import json
import math
import random
from pathlib import Path

from PIL import Image

from eval_worker.dataset import read_object

from .dictionary import extend_characters
from .snapshot import digest, load_snapshot
from .supplement_plan import GROUPS, plan_supplement, validate_plan_options


def validate_render_options(options: dict) -> None:
    validate_plan_options(options)
    if options.get("profile") not in {"dotum", "nanum-neo"}:
        raise ValueError("지원하지 않는 합성 글꼴 모드입니다.")
    scale = options.get("scale")
    if type(scale) not in (int, float) or not math.isfinite(scale) or not 0 < scale <= 16:
        raise ValueError("배율은 0보다 크고 16 이하여야 합니다.")
    for key in ("width", "height"):
        if type(options.get(key)) is not int or not 4 <= options[key] <= 2048:
            raise ValueError("크롭 너비·높이는 4~2048px이어야 합니다.")
    padding = options.get("padding")
    if type(padding) is not int or not 0 <= padding < min(options["width"], options["height"]) / 2:
        raise ValueError("여백은 크롭의 절반보다 작은 0 이상의 정수여야 합니다.")
    for key in ("color", "backgroundColor"):
        value = options.get(key)
        if (
            not isinstance(value, list)
            or len(value) != 3
            or any(type(x) is not int or not 0 <= x <= 255 for x in value)
        ):
            raise ValueError("색상은 RGB 정수 3개여야 합니다.")
    if options.get("backgroundMode") not in {"solid", "images"}:
        raise ValueError("배경 종류를 선택해 주세요.")
    if not isinstance(options.get("fonts"), dict) or set(options["fonts"]) != {
        "gulim",
        "batang",
        "nanum",
        "uttum",
    }:
        raise ValueError("로컬 폰트 경로를 확인해 주세요.")
    for path in options["fonts"].values():
        if not isinstance(path, str) or (path and not Path(path).is_absolute()):
            raise ValueError("폰트에는 로컬 절대 경로를 사용해 주세요.")
    if options["backgroundMode"] == "images" and (
        not isinstance(options.get("backgroundDirectory"), str)
        or not Path(options["backgroundDirectory"]).is_absolute()
    ):
        raise ValueError("글자가 없는 배경 이미지 폴더를 선택해 주세요.")


def background_files(options: dict) -> list[Path]:
    if options["backgroundMode"] == "solid":
        return []
    root = Path(options["backgroundDirectory"]).resolve(strict=True)
    paths = sorted(
        path
        for path in root.iterdir()
        if path.suffix.lower() in {".png", ".jpg", ".jpeg"} and path.is_file()
    )
    if not paths or len(paths) > 1000:
        raise ValueError("배경 폴더에는 PNG/JPEG 1~1000개가 필요합니다.")
    for path in paths:
        with Image.open(path) as source:
            if (
                source.width * source.height > 16_777_216
                or source.width < options["width"]
                or source.height < options["height"]
            ):
                raise ValueError("배경 이미지는 크롭보다 커야 하며 16777216픽셀 이하여야 합니다.")
            if source.convert("RGBA").getextrema()[3] != (255, 255):
                raise ValueError("배경 이미지가 불투명해야 합니다.")
    return paths


def composite(
    foreground: Image.Image, options: dict, paths: list[Path], rng: random.Random
) -> tuple[Image.Image, dict]:
    size = (options["width"], options["height"])
    if (
        foreground.width + 2 * options["padding"] > size[0]
        or foreground.height + 2 * options["padding"] > size[1]
    ):
        raise ValueError("합성 글자가 크롭을 벗어납니다. 배율·크롭 크기·여백을 확인해 주세요.")
    if paths:
        path = rng.choice(paths)
        with Image.open(path) as source:
            rgba = source.convert("RGBA")
            if rgba.getextrema()[3] != (255, 255):
                raise ValueError("배경 이미지가 불투명해야 합니다.")
            x = rng.randint(0, source.width - size[0])
            y = rng.randint(0, source.height - size[1])
            background = rgba.crop((x, y, x + size[0], y + size[1]))
        metadata = {
            "mode": "images",
            "file": path.name,
            "sha256": digest(path),
            "crop": [x, y, *size],
        }
    else:
        background = Image.new("RGBA", size, (*options["backgroundColor"], 255))
        metadata = {"mode": "solid", "rgb": options["backgroundColor"]}
    offset = ((size[0] - foreground.width) // 2, (size[1] - foreground.height) // 2)
    background.alpha_composite(foreground.convert("RGBA"), offset)
    return background.convert("RGB"), {**metadata, "textOffset": list(offset)}


def prepare_supplement(
    request: dict, cancelled=lambda: False, emit=lambda _: None, renderer=None, validator=None
) -> dict:
    root = Path(request["directory"]).resolve(strict=True)
    output = Path(request["outputDirectory"]).resolve(strict=True)
    if (
        not output.is_relative_to(root)
        or output == root
        or request.get("mode") not in {"preview", "generate"}
    ):
        raise ValueError("합성 출력 경로가 올바르지 않습니다.")
    options = request["options"]
    validate_render_options(options)
    dataset, _, _ = load_snapshot(root, options.get("additionalCharacters", ""))
    dictionary = set(
        extend_characters(
            (root / "model/characters.txt").read_text(encoding="utf-8").splitlines(),
            options.get("additionalCharacters", ""),
        )
    ) | {" "}
    cleaned = validate_plan_options(options)
    unsupported = sorted(
        {
            char
            for group in GROUPS
            for char in cleaned["characters"][group]
            if char not in dictionary
        }
    )
    if unsupported:
        raise ValueError("현재 모델 사전에 없는 합성 문자: " + " ".join(unsupported))
    if renderer is None:
        try:
            from dnf_ocr_synth import FontPaths, Renderer, validate_nickname
        except ImportError as error:
            raise ValueError(
                "합성용 Python에 dnf-ocr-synth 0.1.2를 설치해 주세요. GPU Python과 별도로 사용할 수 있습니다."
            ) from error
        renderer = Renderer(
            FontPaths(
                **{key: Path(path) if path else None for key, path in options["fonts"].items()}
            )
        )
        validator = validate_nickname
        version = importlib.metadata.version("dnf-ocr-synth")
    else:
        version = "test-double"
    plan = plan_supplement(dataset["samples"], options, validator, cancelled)
    paths = background_files(options)
    render_options = {
        "profile": options["profile"],
        "scale": options["scale"],
        "color": tuple(options["color"]),
    }
    # Probe the actual font chain, including fallbacks, before generating any training rows.
    for group in GROUPS:
        for char in cleaned["characters"][group]:
            if cancelled():
                raise InterruptedError("합성 준비를 취소했습니다.")
            renderer.render(char, **render_options)
    all_names = plan.pop("nicknames")
    count = min(6, len(all_names)) if request["mode"] == "preview" else len(all_names)
    images = output / "images"
    images.mkdir(exist_ok=False)
    rng = random.Random(options["seed"])
    samples = []
    for index, text in enumerate(all_names[:count]):
        if cancelled():
            raise InterruptedError("합성 준비를 취소했습니다.")
        sample = renderer.render(text, **render_options)
        image, background = composite(sample.image, options, paths, rng)
        name = f"{index:06d}.png"
        target = images / name
        image.save(target)
        samples.append(
            {
                "id": f"synthetic-{index:06d}",
                "text": text,
                "split": "train",
                "image": str(target.relative_to(root)).replace("\\", "/"),
                "sha256": digest(target),
                "width": image.width,
                "height": image.height,
                "rendering": sample.metadata,
                "background": background,
            }
        )
        if index % 100 == 0:
            emit({"type": "message", "message": f"합성 이미지 {index + 1}/{count}개 생성 중"})
    result = {
        "schemaVersion": 1,
        "mode": request["mode"],
        "datasetSha256": digest(root / "dataset.json"),
        "dictionarySha256": digest(root / "model/characters.txt"),
        "renderer": {"package": "dnf-ocr-synth", "version": version},
        "options": options,
        "plan": plan,
        "samples": samples,
    }
    (output / "supplement.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return result


def read_supplement_request(path: Path) -> dict:
    return read_object(path)
