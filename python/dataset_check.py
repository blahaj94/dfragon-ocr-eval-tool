"""Read-only capture inspection and split-leakage checking; never imports OCR or Paddle."""

import hashlib
import io
import json
import re
import sys
import warnings
from collections import defaultdict
from datetime import datetime
from pathlib import Path, PurePosixPath

sys.dont_write_bytecode = True

from PIL import Image  # noqa: E402

from eval_worker.dataset import (  # noqa: E402
    Sample,
    load_samples,
    load_samples_from_rows,
    read_object,
)

SPLITS = {"train", "val", "test"}
SAMPLE_FIELDS = {
    "key",
    "id",
    "image",
    "truth",
    "datasetDirectory",
    "eventId",
    "pixelHash",
    "originalHash",
    "split",
    "confirmedAt",
}
HASH = re.compile(r"[a-f0-9]{64}")
EVENT = re.compile(r"\d{8}-\d{6}-[a-f0-9]{8}")


def sample_key(root: str, image: str) -> str:
    return hashlib.sha256((root + "\0" + image).encode("utf-8")).hexdigest()


def pixel_identity(width: int, height: int, rgba_sha256: str) -> str:
    """Dimensions and canonical decoded RGBA bytes, independent of PNG encoding."""
    descriptor = f"rgba8:{width}:{height}:{rgba_sha256}"
    return hashlib.sha256(descriptor.encode("ascii")).hexdigest()


def decoded_png(path: Path) -> tuple[int, int, str]:
    raw = path.read_bytes()
    if len(raw) < 25 or raw[:8] != b"\x89PNG\r\n\x1a\n" or raw[24] > 8:
        raise ValueError("Expected an 8-bit-or-less PNG capture; no lossy bit-depth conversion.")
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(raw)) as image:
            if image.format != "PNG" or getattr(image, "n_frames", 1) != 1:
                raise ValueError("Expected a single-frame PNG capture.")
            image.verify()
        with Image.open(io.BytesIO(raw)) as image:
            image.load()
            rgba = image.convert("RGBA").tobytes()
            return image.width, image.height, hashlib.sha256(rgba).hexdigest()


def require_selection(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != {
        "pythonExecutable",
        "datasetDirectory",
        "labelsPath",
    }:
        raise ValueError("Invalid DatasetSelection fields.")
    for name, path in value.items():
        if not isinstance(path, str) or not path or not Path(path).is_absolute():
            raise ValueError(f"{name} must be an absolute path.")
    return value


def require_record(value: object) -> dict:
    if (
        not isinstance(value, dict)
        or set(value) != {"schemaVersion", "selection", "samples"}
        or type(value["schemaVersion"]) is not int
        or value["schemaVersion"] != 1
        or not isinstance(value["samples"], list)
    ):
        raise ValueError("Invalid DatasetRecord schema.")
    if value["selection"] is not None:
        require_selection(value["selection"])
    keys = set()
    for sample in value["samples"]:
        if not isinstance(sample, dict) or set(sample) != SAMPLE_FIELDS:
            raise ValueError("Invalid stored DatasetSample fields.")
        for name in ("key", "id", "image", "truth", "datasetDirectory", "eventId", "pixelHash"):
            if not isinstance(sample[name], str) or not sample[name]:
                raise ValueError(f"Stored sample {name} must be nonempty text.")
        image = PurePosixPath(sample["image"])
        if (
            not Path(sample["datasetDirectory"]).is_absolute()
            or len(image.parts) != 2
            or image.as_posix() != sample["image"]
            or "\\" in sample["image"]
            or ":" in sample["image"]
            or not EVENT.fullmatch(sample["eventId"])
            or image.parts[0] != sample["eventId"]
            or not re.fullmatch(r"[0-9]{3,}\.png", image.name)
        ):
            raise ValueError("Invalid stored capture path or event identity.")
        if sample["key"] != sample_key(sample["datasetDirectory"], sample["image"]):
            raise ValueError("Stored sample key differs from its root/image identity.")
        if sample["key"] in keys:
            raise ValueError("Duplicate stored sample key.")
        keys.add(sample["key"])
        if not HASH.fullmatch(sample["pixelHash"]) or (
            sample["originalHash"] is not None
            and (
                not isinstance(sample["originalHash"], str)
                or not HASH.fullmatch(sample["originalHash"])
            )
        ):
            raise ValueError("Stored pixel/original fingerprint is invalid.")
        if sample["split"] is not None and sample["split"] not in SPLITS:
            raise ValueError("Unknown stored dataset split.")
        if sample["confirmedAt"] is not None:
            timestamp = sample["confirmedAt"]
            if not isinstance(timestamp, str) or "T" not in timestamp:
                raise ValueError("Invalid confirmation timestamp.")
            instant = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            if instant.tzinfo is None or sample["split"] is None:
                raise ValueError("Confirmed samples require a timezone and an assigned split.")
    return value


def require_request(value: object) -> tuple[str, dict, dict, dict]:
    if not isinstance(value, dict) or set(value) != {"mode", "record", "selection", "assignments"}:
        raise ValueError("Checker request needs mode, record, selection, assignments.")
    if value["mode"] not in ("load", "check"):
        raise ValueError("Checker mode must be load or check.")
    selection = require_selection(value["selection"])
    record = require_record(value["record"])
    assignments = value["assignments"]
    if not isinstance(assignments, dict):
        raise ValueError("assignments must be an event-to-split object.")
    for event, split in assignments.items():
        if not isinstance(event, str) or not EVENT.fullmatch(event):
            raise ValueError("Invalid assignment event ID.")
        if split is not None and split not in SPLITS:
            raise ValueError("Unknown assignment split.")
    return value["mode"], record, selection, assignments


def issue(severity: str, code: str, message: str, images: list[str]) -> dict:
    return {"severity": severity, "code": code, "message": message, "images": images}


def image_name(sample: dict) -> str:
    return str(Path(sample["datasetDirectory"]) / sample["image"])


class CaptureInspector:
    def __init__(self) -> None:
        self.pixels: dict[Path, tuple[int, int, str]] = {}
        self.originals: dict[Path, str | None] = {}

    def png(self, path: Path) -> tuple[int, int, str]:
        if path not in self.pixels:
            self.pixels[path] = decoded_png(path)
        return self.pixels[path]

    def original_identity(self, sample: Sample, root: Path) -> str | None:
        if sample.metadata_path in self.originals:
            return self.originals[sample.metadata_path]
        source = read_object(sample.metadata_path)["source"]
        width, height = source["width"], source["height"]
        if "pixelFormat" in source and source["pixelFormat"] != "rgba8":
            raise ValueError("Capture source pixelFormat must be rgba8.")
        if "backend" in source and source["backend"] not in {"win32-gdi", "fixture"}:
            raise ValueError("Unsupported capture backend.")
        declared = source.get("rgbaSha256")
        if "rgbaSha256" in source and (
            not isinstance(declared, str) or not HASH.fullmatch(declared)
        ):
            raise ValueError("Capture source rgbaSha256 must be a lowercase SHA256 digest.")
        if source.get("file") not in {None, "original.png"}:
            raise ValueError("Capture original filename must be original.png or null.")
        original = sample.metadata_path.parent / "original.png"
        if source.get("file") == "original.png" and not original.is_file():
            raise ValueError("Capture declares original.png but the file is missing.")
        if original.exists():
            original = original.resolve(strict=True)
            if not original.is_relative_to(root) or not original.is_file():
                raise ValueError("Capture original escapes its dataset root.")
            actual_width, actual_height, actual_digest = self.png(original)
            if (actual_width, actual_height) != (width, height):
                raise ValueError("Original PNG dimensions differ from capture metadata.")
            if declared is not None and actual_digest != declared:
                raise ValueError("Original decoded RGBA pixels differ from source.rgbaSha256.")
            declared = actual_digest
        identity = None if declared is None else pixel_identity(width, height, declared)
        self.originals[sample.metadata_path] = identity
        return identity

    def inspect(self, sample: Sample, root: Path) -> tuple[str, str | None]:
        width, height, rgba_digest = self.png(sample.path)
        return pixel_identity(width, height, rgba_digest), self.original_identity(sample, root)


def check_dataset(request: object) -> dict:
    mode, record, selection, assignments = require_request(request)
    samples = [dict(sample) for sample in record["samples"]]
    by_key = {sample["key"]: sample for sample in samples}
    issues: list[dict] = []
    inspector = CaptureInspector()
    active_root = str(Path(selection["datasetDirectory"]).resolve())
    loaded_keys = set()

    try:
        active = load_samples(Path(active_root), Path(selection["labelsPath"]))
    except (OSError, ValueError, TypeError, KeyError) as error:
        active = []
        issues.append(
            issue("error", "INVALID_LABELS_OR_CAPTURE", str(error), [selection["labelsPath"]])
        )

    for current in active:
        key = sample_key(active_root, current.image)
        loaded_keys.add(key)
        try:
            pixels, original = inspector.inspect(current, Path(active_root))
        except (
            OSError,
            ValueError,
            TypeError,
            KeyError,
            SyntaxError,
            Image.DecompressionBombError,
            Image.DecompressionBombWarning,
        ) as error:
            issues.append(
                issue("error", "INVALID_IMAGE_OR_SOURCE", str(error), [str(current.path)])
            )
            continue
        candidate = {
            "key": key,
            "id": current.id,
            "image": current.image,
            "truth": current.truth,
            "datasetDirectory": active_root,
            "eventId": PurePosixPath(current.image).parts[0],
            "pixelHash": pixels,
            "originalHash": original,
            "split": None,
            "confirmedAt": None,
        }
        previous = by_key.get(key)
        if previous is not None and previous["confirmedAt"] is not None:
            if any(
                previous[name] != candidate[name]
                for name in (
                    "id",
                    "image",
                    "truth",
                    "datasetDirectory",
                    "eventId",
                    "pixelHash",
                    "originalHash",
                )
            ):
                issues.append(
                    issue(
                        "error",
                        "CONFIRMED_SAMPLE_CHANGED",
                        "A confirmed sample's label, pixels, or capture identity changed; its record was preserved.",
                        [str(current.path)],
                    )
                )
            continue
        if previous is not None:
            candidate["split"] = previous["split"]
            previous.update(candidate)
        else:
            samples.append(candidate)
            by_key[key] = candidate

    # Historical rows remain evidence even if their file moved or disappeared. Validate what
    # is still referenced, then keep stored hashes so renamed copies cannot bypass the check.
    for previous in record["samples"]:
        if previous["key"] in loaded_keys:
            continue
        try:
            root = Path(previous["datasetDirectory"]).resolve(strict=True)
            stored = load_samples_from_rows(
                root,
                [{"id": previous["id"], "image": previous["image"], "truth": previous["truth"]}],
            )[0]
            pixels, original = inspector.inspect(stored, root)
            if pixels != previous["pixelHash"] or original != previous["originalHash"]:
                issues.append(
                    issue(
                        "error",
                        "STORED_SAMPLE_CHANGED",
                        "Stored sample pixels or capture identity changed; reload its root before continuing.",
                        [image_name(previous)],
                    )
                )
        except (
            OSError,
            ValueError,
            TypeError,
            KeyError,
            SyntaxError,
            Image.DecompressionBombError,
            Image.DecompressionBombWarning,
        ) as error:
            issues.append(
                issue("error", "INVALID_STORED_SAMPLE", str(error), [image_name(previous)])
            )

    active_rows = [sample for sample in samples if sample["datasetDirectory"] == active_root]
    for field in ("id", "image"):
        identities: dict[str, list[dict]] = defaultdict(list)
        for sample in active_rows:
            identities[sample[field]].append(sample)
        for group in identities.values():
            if len(group) > 1:
                issues.append(
                    issue(
                        "error",
                        "DUPLICATE_ACTIVE_IDENTITY",
                        f"Merged active samples have a duplicate {field}; labels exports must stay unambiguous.",
                        [image_name(sample) for sample in group],
                    )
                )
    canonical_images: dict[Path, list[dict]] = defaultdict(list)
    for sample in active_rows:
        canonical_images[Path(image_name(sample)).resolve()].append(sample)
    for group in canonical_images.values():
        if len(group) > 1:
            issues.append(
                issue(
                    "error",
                    "DUPLICATE_ACTIVE_PATH",
                    "Merged active rows resolve to the same image file.",
                    [image_name(sample) for sample in group],
                )
            )

    if mode == "check":
        active_events = {
            sample["eventId"] for sample in samples if sample["datasetDirectory"] == active_root
        }
        for event in assignments:
            if event not in active_events:
                issues.append(
                    issue(
                        "error",
                        "UNKNOWN_EVENT",
                        "An assignment refers to an unknown active capture.",
                        [event],
                    )
                )
        for sample in samples:
            if (
                sample["datasetDirectory"] == active_root
                and sample["confirmedAt"] is None
                and sample["eventId"] in assignments
            ):
                sample["split"] = assignments[sample["eventId"]]
        for sample in active_rows:
            if (
                sample["confirmedAt"] is None
                and sample["split"] is not None
                and sample["key"] not in loaded_keys
            ):
                issues.append(
                    issue(
                        "error",
                        "PENDING_SAMPLE_MISSING_FROM_LABELS",
                        "Current labels no longer contain this selected unconfirmed sample; restore or reload labels before confirming.",
                        [image_name(sample)],
                    )
                )

    assigned = [sample for sample in samples if sample["split"] is not None]
    for field, code, description in (
        ("eventId", "CAPTURE_SPLIT_LEAKAGE", "The same capture event appears in different splits."),
        (
            "originalHash",
            "ORIGINAL_SPLIT_LEAKAGE",
            "The same original pixels appear in different splits.",
        ),
        (
            "pixelHash",
            "PIXEL_SPLIT_LEAKAGE",
            "Identical decoded ROI pixels appear in different splits.",
        ),
    ):
        groups: dict[str, list[dict]] = defaultdict(list)
        for sample in assigned:
            if sample[field] is not None:
                groups[sample[field]].append(sample)
        for group in groups.values():
            if len({sample["split"] for sample in group}) > 1:
                issues.append(
                    issue("error", code, description, [image_name(sample) for sample in group])
                )
            elif field == "pixelHash" and len(group) > 1:
                issues.append(
                    issue(
                        "warning",
                        "DUPLICATE_PIXELS_IN_SPLIT",
                        "Identical decoded ROI pixels occur more than once in the same split.",
                        [image_name(sample) for sample in group],
                    )
                )

    counts = {"train": 0, "val": 0, "test": 0, "unassigned": 0}
    for sample in samples:
        if sample["datasetDirectory"] == active_root:
            counts[sample["split"] or "unassigned"] += 1
    return {
        "passed": not any(item["severity"] == "error" for item in issues),
        "counts": counts,
        "issues": issues,
        "samples": samples,
    }


def main() -> int:
    # The request is fully consumed before any NumPy/Paddle code could be involved; this
    # checker uses only Pillow and never starts a background stdin reader.
    try:

        def unique_pairs(pairs: list[tuple[str, object]]) -> dict:
            value = {}
            for key, item in pairs:
                if key in value:
                    raise ValueError(f"Duplicate request JSON key: {key}.")
                value[key] = item
            return value

        request = json.load(sys.stdin, object_pairs_hook=unique_pairs)
        result = check_dataset(request)
        exit_code = 0
    except (OSError, ValueError, TypeError, KeyError) as error:
        result = {
            "passed": False,
            "counts": {"train": 0, "val": 0, "test": 0, "unassigned": 0},
            "issues": [issue("error", "INVALID_PROTOCOL", str(error), [])],
            "samples": [],
        }
        exit_code = 1
    sys.stdout.write(json.dumps(result, ensure_ascii=False, allow_nan=False) + "\n")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
