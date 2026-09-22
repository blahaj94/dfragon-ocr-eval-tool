"""Convert Cropper's saved ground truth to evaluation labels, without OCR or source edits."""

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True

from eval_worker.dataset import (  # noqa: E402
    load_samples_from_rows,
    read_object,
    validate_metadata,
)

# Match JavaScript String.trim only to identify Cropper's unanswered values.
# Nonblank answers are exported verbatim, including surrounding whitespace.
TRIM_CHARACTERS = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
EVENT = re.compile(r"[0-9]{8}-[0-9]{6}-[a-f0-9]{8}")


def transfer(captures: Path, output: Path | None = None) -> dict:
    root = captures.resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Select the captures directory, not an individual event or file.")
    destination = (output or root / "labels.json").absolute()
    if destination.exists() or destination.is_symlink():
        raise FileExistsError(f"Output already exists; choose a new --output path: {destination}")
    rows = []
    snapshots = {}
    unanswered = 0
    events = 0
    for directory in sorted(root.iterdir()):
        if directory.is_symlink():
            raise ValueError(f"Symbolic links are not supported in captures: {directory.name}")
        if not directory.is_dir():
            continue
        if not EVENT.fullmatch(directory.name):
            raise ValueError(f"Unexpected capture directory: {directory.name}")
        metadata_path = (directory / "metadata.json").resolve(strict=True)
        if not metadata_path.is_relative_to(root):
            raise ValueError(f"Metadata escapes the capture root: {directory.name}")
        snapshots[metadata_path] = metadata_path.read_bytes()
        regions = validate_metadata(metadata_path, directory.name)
        metadata = read_object(metadata_path)
        answers = {}
        if "groundTruth" in metadata:
            ground_truth = metadata["groundTruth"]
            if (
                not isinstance(ground_truth, dict)
                or type(ground_truth.get("schemaVersion")) is not int
                or ground_truth["schemaVersion"] != 1
                or not isinstance(ground_truth.get("regions"), dict)
            ):
                raise ValueError(f"Unsupported groundTruth in {directory.name}/metadata.json")
            answers = ground_truth["regions"]
        known = {str(region["id"]) for region in regions.values()}
        for key, text in answers.items():
            if key not in known:
                raise ValueError(f"Ground truth refers to unknown ROI {directory.name}/{key}")
            if text is not None and (
                not isinstance(text, str) or len(text.encode("utf-16-le")) // 2 > 500
            ):
                raise ValueError(f"Invalid ground truth for {directory.name}/{key}")
        for filename, region in regions.items():
            text = answers.get(str(region["id"]))
            if text is None or not text.strip(TRIM_CHARACTERS):
                unanswered += 1
                continue
            image = f"{directory.name}/{filename}"
            rows.append({"id": image.removesuffix(".png"), "image": image, "truth": text})
        events += 1
    if not rows:
        raise ValueError(
            f"No saved answers to export ({events} events, {unanswered} unanswered ROIs). "
            "Save answers in Cropper's Ground Truth tab first. No labels file was created."
        )
    # Reuse the evaluation reader's exact path, metadata, ROI and PNG-header validation.
    load_samples_from_rows(root, rows)
    if any(path.read_bytes() != content for path, content in snapshots.items()):
        raise ValueError("Capture metadata changed during conversion. Retry after saving answers.")
    content = json.dumps({"schemaVersion": 1, "samples": rows}, ensure_ascii=False, indent=2) + "\n"
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=destination.parent,
            delete=False,
            prefix=".transfer-",
            suffix=".tmp",
        ) as stream:
            temporary = Path(stream.name)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        # Publish the complete file atomically; unlike replace(), link() never overwrites.
        os.link(temporary, destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return {
        "output": str(destination),
        "events": events,
        "samples": len(rows),
        "unanswered": unanswered,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("captures", type=Path, help="Cropper captures root directory")
    parser.add_argument("--output", type=Path, help="New JSON file (default: captures/labels.json)")
    args = parser.parse_args()
    try:
        result = transfer(args.captures, args.output)
    except (OSError, ValueError) as error:
        print(f"Transfer failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
