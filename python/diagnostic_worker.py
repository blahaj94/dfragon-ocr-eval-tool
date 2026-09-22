"""One isolated, read-only diagnostic. JSONL on stdout; native logs on stderr."""

import argparse
import json
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True

from eval_worker.diagnostics import read_json_bytes, run_diagnostic  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Observe saved evaluation input and backbone shapes"
    )
    parser.add_argument("--request", required=True, type=Path)
    args = parser.parse_args()
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    sys.stdout = sys.stderr

    def emit(event: dict) -> None:
        protocol.write(json.dumps(event, ensure_ascii=False, allow_nan=False) + "\n")
        protocol.flush()

    try:
        request = read_json_bytes(args.request.read_bytes())
        result = run_diagnostic(request, emit)
        emit({"type": "result", "result": result})
        return 0
    except Exception as error:
        emit({"type": "error", "message": f"{type(error).__name__}: {error}"})
        return 1
    finally:
        protocol.close()


if __name__ == "__main__":
    raise SystemExit(main())
