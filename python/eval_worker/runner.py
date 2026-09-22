"""Sequential evaluation and immutable per-run reports."""

import hashlib
import json
import math
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

from .adapter import LdbOcrAdapter, sha256
from .dataset import load_samples, read_object

SETTINGS_KEYS = {
    "runDirectory",
    "checkpointPath",
    "datasetDirectory",
    "labelsPath",
    "outputDirectory",
    "ldbOcrSourcePath",
}


class Cancellation(Protocol):
    def is_set(self) -> bool: ...


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def settings_from_file(path: Path) -> dict:
    settings = read_object(path)
    if set(settings) != SETTINGS_KEYS:
        raise ValueError("Request fields must be exactly: " + ", ".join(sorted(SETTINGS_KEYS)))
    for key, value in settings.items():
        if not isinstance(value, str) or not value or not Path(value).is_absolute():
            raise ValueError(f"{key} must be an absolute path.")
    return settings


def run_evaluation(
    settings: dict,
    cancel: Cancellation,
    emit: Callable[[dict], None],
    adapter_factory: Callable = LdbOcrAdapter,
) -> tuple[Path, dict]:
    output = Path(settings["outputDirectory"]).resolve()
    for key in ("runDirectory", "datasetDirectory", "ldbOcrSourcePath"):
        source = Path(settings[key]).resolve()
        if output == source or output.is_relative_to(source):
            raise ValueError(f"Output must be outside {key}; source data must remain unchanged.")
    output.mkdir(parents=True, exist_ok=True)
    report_directory = (
        output / f"eval-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:12]}"
    )
    report_directory.mkdir(exist_ok=False)
    report_path = report_directory / "report.json"
    report = {
        "schemaVersion": 1,
        "status": "failed",
        "totalSamples": 0,
        "processedSamples": 0,
        "summary": None,
        "partialSummary": None,
        "samples": [],
        "error": None,
        "startedAt": utc_now(),
        "finishedAt": None,
        "reproducibility": {"settings": settings, "normalization": "none", "batchSize": 1},
    }
    pairs = []
    adapter = None
    try:
        samples = load_samples(Path(settings["datasetDirectory"]), Path(settings["labelsPath"]))
        report["totalSamples"] = len(samples)
        report["reproducibility"]["labelsSha256"] = sha256(Path(settings["labelsPath"]))
        emit({"type": "started", "totalSamples": len(samples)})
        if cancel.is_set():
            report["status"] = "cancelled"
        else:
            adapter = adapter_factory(settings)
            report["reproducibility"].update(adapter.reproducibility)
            # Validate every selected PNG before the first inference; no sample is silently skipped.
            for sample in samples:
                if cancel.is_set():
                    break
                adapter.validate_image(sample.path.read_bytes())
            for sample in samples:
                if cancel.is_set():
                    break
                raw = sample.path.read_bytes()
                prediction, confidence = adapter.predict(raw)
                if not isinstance(prediction, str):
                    raise ValueError("The recognition adapter returned a non-string prediction.")
                if confidence is not None and (
                    type(confidence) not in (int, float)
                    or not math.isfinite(confidence)
                    or not 0 <= confidence <= 1
                ):
                    raise ValueError("The recognition adapter returned invalid confidence.")
                result = {
                    "id": sample.id,
                    "imagePath": str(sample.path),
                    "truth": sample.truth,
                    "prediction": prediction,
                    "editDistance": adapter.edit_distance(sample.truth, prediction),
                    "confidence": confidence,
                    "imageSha256": hashlib.sha256(raw).hexdigest(),
                    "metadataSha256": sha256(sample.metadata_path),
                }
                pairs.append((sample.truth, prediction))
                report["samples"].append(result)
                report["processedSamples"] = len(pairs)
                emit(
                    {
                        "type": "progress",
                        "processedSamples": len(pairs),
                        "totalSamples": len(samples),
                        "sample": result,
                    }
                )
            report["status"] = "cancelled" if cancel.is_set() else "completed"
            if report["status"] == "completed":
                report["summary"] = adapter.summarize(pairs)
            elif pairs:
                report["partialSummary"] = adapter.summarize(pairs)
    except Exception as error:
        report["status"] = "failed"
        report["summary"] = None
        report["error"] = f"{type(error).__name__}: {error}"
        if adapter is not None and pairs:
            try:
                report["partialSummary"] = adapter.summarize(pairs)
            except Exception as summary_error:
                report["partialSummary"] = None
                report["error"] += f"; partial metrics failed: {summary_error}"
    finally:
        report["finishedAt"] = utc_now()
        with report_path.open("x", encoding="utf-8") as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
    emit({"type": "finished", "reportPath": str(report_path), "report": report})
    return report_path, report
