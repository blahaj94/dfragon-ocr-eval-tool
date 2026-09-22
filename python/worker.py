"""JSONL subprocess entry point. Native/Python model logs go exclusively to stderr."""

import argparse
import json
import os
import sys
import threading
from pathlib import Path

from eval_worker.runner import run_evaluation, settings_from_file


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate explicitly labelled Cropper ROI PNGs")
    parser.add_argument("--request", required=True, type=Path)
    args = parser.parse_args()
    # Keep an independent JSONL channel before redirecting fd 1 as well as Python sys.stdout.
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    sys.stdout = sys.stderr
    cancel = threading.Event()

    def emit(event: dict) -> None:
        protocol.write(json.dumps(event, ensure_ascii=False, allow_nan=False) + "\n")
        protocol.flush()

    def read_commands() -> None:
        for line in sys.stdin:
            try:
                command = json.loads(line)
                if command == {"type": "cancel"}:
                    cancel.set()
            except (ValueError, TypeError):
                continue

    threading.Thread(target=read_commands, daemon=True).start()
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
