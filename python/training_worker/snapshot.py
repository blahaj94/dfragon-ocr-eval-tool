import hashlib
import re
import unicodedata
from pathlib import Path

from PIL import Image

from eval_worker.dataset import read_object

from .dictionary import extend_characters

SAMPLE_ID = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(?:[1-9]|1[0-2])"
)


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def load_snapshot(directory: Path, additional_characters: str = "") -> tuple[dict, dict, list[str]]:
    root = directory.resolve(strict=True)
    dataset_path = root / "dataset.json"
    ready = read_object(root / "ready.json")
    if digest(dataset_path) != ready.get("datasetSha256"):
        raise ValueError("Downloaded dataset metadata changed.")
    dataset = read_object(dataset_path)
    model = read_object(root / "model/model.json")
    if (
        dataset.get("schemaVersion") != 1
        or model.get("preset") != "korean-ppocrv5"
        or dataset.get("modelId") != model.get("id")
    ):
        raise ValueError("Unsupported dataset or model contract.")
    names = set()
    for item in model["files"]:
        name = item["name"]
        if name not in {"weights.pdparams", "characters.txt", "evaluation.json"} or name in names:
            raise ValueError("Invalid model file list.")
        path = (root / "model" / name).resolve(strict=True)
        if (
            not path.is_relative_to(root)
            or path.stat().st_size != item["bytes"]
            or digest(path) != item["sha256"]
        ):
            raise ValueError("Downloaded model integrity mismatch.")
        names.add(name)
    if not {"weights.pdparams", "characters.txt"} <= names:
        raise ValueError("Model weights and dictionary are required.")
    dictionary = (root / "model/characters.txt").read_text(encoding="utf-8").splitlines()
    if (
        not dictionary
        or any(
            len(char) != 1
            or char == " "
            or unicodedata.category(char) in {"Cc", "Cs"}
            or char == "\ufeff"
            for char in dictionary
        )
        or len(set(dictionary)) != len(dictionary)
    ):
        raise ValueError("Invalid model character dictionary.")
    characters = set(extend_characters(dictionary, additional_characters)) | {" "}
    text_splits = {}
    pixel_splits = {}
    capture_splits: dict[str, set[str]] = {}
    seen = set()
    counts = {"train": 0, "val": 0, "test": 0}
    for row in dataset["samples"]:
        sample_id = row.get("id")
        if (
            not isinstance(sample_id, str)
            or not SAMPLE_ID.fullmatch(sample_id)
            or sample_id in seen
        ):
            raise ValueError("Invalid or duplicate sample ID.")
        if (
            row.get("image") != f"images/{sample_id}.png"
            or row.get("excluded") is not False
            or row.get("split") not in counts
        ):
            raise ValueError(
                "Only the server's assigned, non-excluded samples can be trained/evaluated."
            )
        if sample_id != f"{row.get('captureId')}-{row.get('slot')}":
            raise ValueError("Sample and capture identity disagree.")
        text = row.get("text")
        if (
            not isinstance(text, str)
            or not text
            or len(text) > 25
            or any(char not in characters for char in text)
        ):
            missing = sorted(set(text) - characters) if isinstance(text, str) else []
            raise ValueError(
                f"Sample {sample_id}: label is too long or contains characters missing from the model dictionary: "
                + " ".join(f"{char!r} (U+{ord(char):04X})" for char in missing)
            )
        split = row["split"]
        normalized = unicodedata.normalize("NFC", text)
        if normalized in text_splits and text_splits[normalized] != split:
            raise ValueError("The same nickname occurs in multiple splits.")
        text_splits[normalized] = split
        path = (root / row["image"]).resolve(strict=True)
        if not path.is_relative_to(root) or digest(path) != row.get("sha256"):
            raise ValueError(f"Sample {sample_id}: image integrity mismatch.")
        with Image.open(path) as image:
            if image.format != "PNG" or image.size != (row["width"], row["height"]):
                raise ValueError("Image dimensions disagree with the snapshot.")
            if image.width * image.height > 16_777_216:
                raise ValueError("Image exceeds the supported dimensions.")
            pixels = image.convert("RGBA")
            if pixels.getextrema()[3] != (255, 255):
                raise ValueError("Transparent training images are unsupported.")
            key = hashlib.sha256(
                f"{image.width}x{image.height}:".encode() + pixels.tobytes()
            ).hexdigest()
        if key in pixel_splits and pixel_splits[key] != split:
            raise ValueError("Identical decoded pixels occur in multiple splits.")
        pixel_splits[key] = split
        capture_splits.setdefault(row["captureId"], set()).add(split)
        counts[split] += 1
        seen.add(sample_id)
    if any(counts[split] == 0 or counts[split] != dataset["counts"].get(split) for split in counts):
        raise ValueError("All three splits must be nonempty and match the saved counts.")
    warnings = []
    mixed = sum(len(splits) > 1 for splits in capture_splits.values())
    if mixed:
        warnings.append(
            f"{mixed} captures contain different nicknames assigned to different splits; server nickname assignments are preserved."
        )
    return dataset, model, warnings
