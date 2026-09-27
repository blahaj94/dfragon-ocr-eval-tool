"""JSONL entry point for local GPU training; native model logs remain on stderr."""

import argparse
import json
import os
import sys
from pathlib import Path

from training_worker.runner import Cancelled, read_request, run_training


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--cancel-file", required=True, type=Path)
    args = parser.parse_args()
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    sys.stdout = sys.stderr

    def emit(value: dict) -> None:
        protocol.write(json.dumps(value, ensure_ascii=False, allow_nan=False) + "\n")
        protocol.flush()

    try:
        run_training(read_request(args.request), args.cancel_file.exists, emit)
        return 0
    except Cancelled:
        emit(
            {"type": "cancelled", "message": "학습·평가를 취소했습니다. 저장된 파일은 유지됩니다."}
        )
        return 0
    except Exception as error:
        emit({"type": "error", "message": f"{type(error).__name__}: {error}"})
        return 1
    finally:
        protocol.close()


if __name__ == "__main__":
    raise SystemExit(main())
