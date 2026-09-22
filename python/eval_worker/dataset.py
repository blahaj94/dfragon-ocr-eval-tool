"""Strict labels-to-Cropper-ROI association, without changing source data."""

import json
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


@dataclass(frozen=True)
class Sample:
    id: str
    image: str
    path: Path
    truth: str
    metadata_path: Path


def read_object(path: Path) -> dict:
    def unique_pairs(pairs: list[tuple[str, object]]) -> dict:
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"Duplicate JSON key {key!r} in {path.name}.")
            result[key] = value
        return result

    with path.open(encoding="utf-8") as stream:
        value = json.load(stream, object_pairs_hook=unique_pairs)
    if not isinstance(value, dict):
        raise ValueError(f"{path.name} must contain a JSON object.")
    return value


def positive_integer(value: object) -> bool:
    return type(value) is int and value > 0


def validate_metadata(path: Path, event_id: str) -> dict[str, dict]:
    metadata = read_object(path)
    if metadata.get("schemaVersion") != 1 or type(metadata.get("schemaVersion")) is not int:
        raise ValueError(f"Unsupported Cropper metadata schema: {path}.")
    if metadata.get("eventId") != event_id:
        raise ValueError(f"Cropper eventId does not match its directory: {path}.")
    if metadata.get("coordinateSpace") != "primary-monitor-physical-pixels":
        raise ValueError(f"Unsupported Cropper coordinate space: {path}.")
    source = metadata.get("source")
    if not isinstance(source, dict) or not all(
        positive_integer(source.get(key)) for key in ("width", "height")
    ):
        raise ValueError(f"Cropper source dimensions are invalid: {path}.")
    regions = metadata.get("regions")
    if not isinstance(regions, list) or not regions:
        raise ValueError(f"Cropper metadata needs regions: {path}.")

    files = {}
    ids = set()
    for region in regions:
        if not isinstance(region, dict) or not positive_integer(region.get("id")):
            raise ValueError(f"Invalid Cropper region: {path}.")
        expected_file = f"{region['id']:03d}.png"
        if region.get("file") != expected_file or expected_file in files or region["id"] in ids:
            raise ValueError(f"Invalid or duplicate Cropper ROI filename: {path}.")
        if not all(positive_integer(region.get(key)) for key in ("width", "height")):
            raise ValueError(f"Invalid Cropper ROI dimensions: {path}.")
        if not all(type(region.get(key)) is int and region[key] >= 0 for key in ("x", "y")):
            raise ValueError(f"Invalid Cropper ROI coordinates: {path}.")
        if (
            region["x"] + region["width"] > source["width"]
            or region["y"] + region["height"] > source["height"]
        ):
            raise ValueError(f"Cropper ROI exceeds source bounds: {path}.")
        files[expected_file] = region
        ids.add(region["id"])
    return files


def load_samples(dataset_directory: Path, labels_path: Path) -> list[Sample]:
    root = dataset_directory.resolve(strict=True)
    if not root.is_dir():
        raise ValueError("datasetDirectory must be the Cropper captures directory.")
    labels = read_object(labels_path)
    if set(labels) != {"schemaVersion", "samples"} or type(labels["schemaVersion"]) is not int:
        raise ValueError("labels.json requires exactly schemaVersion and samples.")
    if labels["schemaVersion"] != 1:
        raise ValueError("Only labels schemaVersion 1 is supported.")
    return load_samples_from_rows(root, labels["samples"])


def load_samples_from_rows(dataset_directory: Path, rows: object) -> list[Sample]:
    """Validate labels or already stored rows with the same ROI association rules."""
    root = dataset_directory.resolve(strict=True)
    if not root.is_dir():
        raise ValueError("datasetDirectory must be the Cropper captures directory.")
    if not isinstance(rows, list) or not rows:
        raise ValueError("labels.json samples must be a nonempty array.")

    samples = []
    ids: set[str] = set()
    paths: set[Path] = set()
    metadata_cache: dict[Path, dict] = {}
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or set(row) != {"id", "image", "truth"}:
            raise ValueError(f"Sample {index + 1} needs exactly id, image, truth.")
        if not all(isinstance(row[key], str) and row[key] for key in ("id", "image", "truth")):
            raise ValueError(f"Sample {index + 1} id, image, truth must be nonempty strings.")
        if row["id"] in ids:
            raise ValueError(f"Duplicate sample id: {row['id']}.")
        relative = PurePosixPath(row["image"])
        if (
            relative.is_absolute()
            or len(relative.parts) != 2
            or relative.as_posix() != row["image"]
            or "\\" in row["image"]
            or ":" in row["image"]
            or any(part in {".", ".."} for part in relative.parts)
            or not re.fullmatch(r"\d{8}-\d{6}-[0-9a-f]{8}", relative.parts[0])
            or not re.fullmatch(r"[0-9]{3,}\.png", relative.name)
        ):
            raise ValueError(f"Sample {row['id']} image must be <eventId>/<ROI number>.png.")
        image = (root / row["image"]).resolve(strict=True)
        if not image.is_file() or not image.is_relative_to(root):
            raise ValueError(f"Sample {row['id']} escapes the capture root or is not a file.")
        if image in paths:
            raise ValueError(f"Duplicate image in labels: {row['image']}.")
        metadata_path = (root / relative.parts[0] / "metadata.json").resolve(strict=True)
        if not metadata_path.is_relative_to(root):
            raise ValueError("Cropper metadata must remain inside the capture root.")
        if metadata_path not in metadata_cache:
            metadata_cache[metadata_path] = validate_metadata(metadata_path, relative.parts[0])
        regions = metadata_cache[metadata_path]
        if relative.name not in regions:
            raise ValueError(f"Sample {row['id']} is not a metadata ROI.")

        # Header checks validate association. Pixel validation uses ldb-ocr's tensor_from_png.
        with image.open("rb") as stream:
            header = stream.read(24)
        if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
            raise ValueError(f"Sample {row['id']} is not a PNG image.")
        dimensions = (int.from_bytes(header[16:20], "big"), int.from_bytes(header[20:24], "big"))
        region = regions[relative.name]
        if dimensions != (region["width"], region["height"]):
            raise ValueError(f"Sample {row['id']} PNG dimensions differ from Cropper metadata.")
        samples.append(Sample(row["id"], row["image"], image, row["truth"], metadata_path))
        ids.add(row["id"])
        paths.add(image)
    return samples
