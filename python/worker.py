"""JSONL subprocess entry point. Native/Python model logs go exclusively to stderr."""

import argparse
import json
import os
import sys
from pathlib import Path

from eval_worker.runner import run_evaluation, settings_from_file


class FileCancellation:
    def __init__(self, path: Path) -> None:
        self.path = path

    def is_set(self) -> bool:
        return self.path.exists()


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate explicitly labelled Cropper ROI PNGs")
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--cancel-file", required=True, type=Path)
    args = parser.parse_args()
    # Keep an independent JSONL channel before redirecting fd 1 as well as Python sys.stdout.
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    sys.stdout = sys.stderr
    # A background stdin reader can deadlock native NumPy imports on Windows.
    # Poll an owned marker at evaluation boundaries instead (numpy/numpy#24290).
    cancel = FileCancellation(args.cancel_file)

    def emit(event: dict) -> None:
        protocol.write(json.dumps(event, ensure_ascii=False, allow_nan=False) + "\n")
        protocol.flush()

    try:
        settings = settings_from_file(args.request)
        _, report = run_evaluation(settings, cancel, emit)
        return 1 if report["status"] == "failed" else 0
    except Exception as error:
        emit({"type": "error", "message": f"{type(error).__name__}: {error}"})
        return 1
    finally:
        protocol.close()


if __name__ == "__main__":
    raise SystemExit(main())
