"""Run synthesis with its own local Python, independently of the GPU runtime."""

import argparse
import json
from pathlib import Path

from training_worker.supplement import prepare_supplement, read_supplement_request


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--cancel-file", type=Path, required=True)
    args = parser.parse_args()

    def emit(value):
        print(json.dumps(value, ensure_ascii=False, allow_nan=False), flush=True)

    try:
        request = read_supplement_request(args.request)
        prepare_supplement(request, args.cancel_file.exists, emit)
        emit({"type": "finished"})
        return 0
    except InterruptedError:
        emit({"type": "cancelled"})
        return 0
    except Exception as error:
        emit({"type": "error", "message": f"{type(error).__name__}: {error}"})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
