"""Bind an isolated diagnostic to saved evidence, without reading labels or metadata."""

import hashlib
import importlib
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .adapter import REQUIRED_MODULES, LdbOcrAdapter, sha256, source_directory, validate_run
from .runner import SETTINGS_KEYS

HASH = re.compile(r"[0-9a-f]{64}")
MAX_REPORT_BYTES = 64 * 1024 * 1024
MAX_IMAGE_BYTES = 16 * 1024 * 1024
SUPPORTED_PREPROCESSING_SHA256 = "3a2bcbfbb34319c4ce951bd2d71aee4e20eba476b57a39cfc1d57b44b95b1a60"


def read_json_bytes(raw: bytes) -> dict:
    def unique(pairs: list[tuple[str, object]]) -> dict:
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"Duplicate JSON key: {key}.")
            result[key] = value
        return result

    value = json.loads(raw.decode("utf-8"), object_pairs_hook=unique)
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object.")
    return value


def digest_value(value: object, name: str) -> str:
    if not isinstance(value, str) or not HASH.fullmatch(value):
        raise ValueError(f"Missing or invalid saved SHA256: {name}.")
    return value


def bounded_bytes(path: Path, limit: int) -> bytes:
    with path.open("rb") as stream:
        raw = stream.read(limit + 1)
    if not raw or len(raw) > limit:
        raise ValueError(f"File is empty or exceeds the diagnostic size limit: {path.name}.")
    return raw


@dataclass
class Evidence:
    report_path: Path
    sample_id: str
    settings: dict
    raw: bytes
    pooling_policy: str
    protected: dict[Path, str]
    upstream: Path
    revision: str
    runtime: dict
    run_request: dict

    def verify_unchanged(self) -> None:
        for path, expected in self.protected.items():
            if sha256(path) != expected:
                raise ValueError(f"Saved diagnostic evidence changed: {path.name}.")


def verify_upstream(upstream: Path, revision: str) -> None:
    head = subprocess.run(
        ["git", "-C", str(upstream), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    if head != revision:
        raise ValueError("PaddleOCR revision differs from the saved report.")
    unchanged = subprocess.run(
        [
            "git",
            "-C",
            str(upstream),
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--quiet",
            "HEAD",
            "--",
            "ppocr",
        ],
        capture_output=True,
        check=False,
    )
    if unchanged.returncode != 0:
        raise ValueError("PaddleOCR model source has uncommitted changes or cannot be verified.")


def verify_request(request: object) -> tuple[Evidence, bool]:
    if not isinstance(request, dict) or set(request) != {
        "reportPath",
        "reportSha256",
        "sampleId",
        "includeShapes",
    }:
        raise ValueError(
            "Diagnostic request requires reportPath/reportSha256/sampleId/includeShapes."
        )
    if (
        not isinstance(request["reportPath"], str)
        or not Path(request["reportPath"]).is_absolute()
        or not isinstance(request["sampleId"], str)
        or not request["sampleId"]
        or type(request["includeShapes"]) is not bool
    ):
        raise ValueError("Invalid diagnostic request values.")
    report_path = Path(request["reportPath"]).resolve(strict=True)
    report_hash = digest_value(request["reportSha256"], "reportSha256")
    report_raw = bounded_bytes(report_path, MAX_REPORT_BYTES)
    if hashlib.sha256(report_raw).hexdigest() != report_hash:
        raise ValueError("The selected report changed before diagnostics started.")
    report = read_json_bytes(report_raw)
    samples = report.get("samples")
    if (
        type(report.get("schemaVersion")) is not int
        or report["schemaVersion"] != 1
        or report.get("status") not in {"completed", "cancelled", "failed"}
        or not isinstance(samples, list)
        or not samples
        or type(report.get("totalSamples")) is not int
        or type(report.get("processedSamples")) is not int
        or report["totalSamples"] < len(samples)
        or report["processedSamples"] != len(samples)
    ):
        raise ValueError(
            "Diagnostics require evaluated samples in a terminal schemaVersion 1 report."
        )
    if report["status"] == "completed":
        if (
            report["totalSamples"] != len(samples)
            or not isinstance(report.get("summary"), dict)
            or report.get("error") is not None
        ):
            raise ValueError("Completed report counts, summary, or error are inconsistent.")
    elif (
        report.get("summary") is not None
        or (report["status"] == "cancelled" and report.get("error") is not None)
        or (
            report["status"] == "failed"
            and (not isinstance(report.get("error"), str) or not report["error"])
        )
    ):
        raise ValueError("Partial report status, summary, or error are inconsistent.")
    ids = set()
    selected = None
    for sample in samples:
        if (
            not isinstance(sample, dict)
            or not isinstance(sample.get("id"), str)
            or not sample["id"]
            or sample["id"] in ids
            or not isinstance(sample.get("imagePath"), str)
            or not Path(sample["imagePath"]).is_absolute()
        ):
            raise ValueError("Report samples need unique IDs and absolute image paths.")
        digest_value(sample.get("imageSha256"), "imageSha256")
        ids.add(sample["id"])
        if sample["id"] == request["sampleId"]:
            selected = sample
    if selected is None:
        raise ValueError("The requested sample is absent from the report.")
    reproducibility = report.get("reproducibility")
    if not isinstance(reproducibility, dict):
        raise ValueError("The report lacks diagnostic reproducibility evidence.")
    settings = reproducibility.get("settings")
    if (
        not isinstance(settings, dict)
        or set(settings) != SETTINGS_KEYS
        or any(
            not isinstance(value, str) or not Path(value).is_absolute()
            for value in settings.values()
        )
        or reproducibility.get("normalization") != "none"
        or reproducibility.get("batchSize") != 1
    ):
        raise ValueError("The report has an unsupported input/settings contract.")
    source = source_directory(Path(settings["ldbOcrSourcePath"]))
    run = Path(settings["runDirectory"]).resolve(strict=True)
    checkpoint = Path(settings["checkpointPath"]).resolve(strict=True)
    source_hashes = reproducibility.get("sourceSha256")
    if not isinstance(source_hashes, dict):
        raise ValueError("The report has no source module digests.")
    if source_hashes.get("training/preprocessing.py") != SUPPORTED_PREPROCESSING_SHA256:
        raise ValueError(
            "Unsupported preprocessing source: its actual stage order has not been verified."
        )
    protected = {report_path: report_hash}
    for name in REQUIRED_MODULES:
        protected[source / "ldb_ocr" / name] = digest_value(source_hashes.get(name), name)
    for name, path in {
        "checkpointSha256": checkpoint,
        "dictionarySha256": run / "characters.txt",
        "configSha256": run / "config.yml",
        "requestSha256": run / "request.json",
        "trainingReportSha256": run / "training.json",
    }.items():
        protected[path] = digest_value(reproducibility.get(name), name)
    root = Path(settings["datasetDirectory"]).resolve(strict=True)
    image_path = Path(selected["imagePath"]).resolve(strict=True)
    if (
        not root.is_dir()
        or not image_path.is_relative_to(root)
        or image_path.suffix.lower() != ".png"
    ):
        raise ValueError("The report image is outside its capture root or is not PNG.")
    raw = bounded_bytes(image_path, MAX_IMAGE_BYTES)
    image_hash = selected["imageSha256"]
    if hashlib.sha256(raw).hexdigest() != image_hash:
        raise ValueError("The image differs from the exact bytes evaluated in the report.")
    protected[image_path] = image_hash
    # Verify files before parsing/executing selected source or loading a checkpoint.
    for path, expected in protected.items():
        if sha256(path) != expected:
            raise ValueError(f"Saved diagnostic evidence changed: {path.name}.")
    run_request, training = validate_run(run, checkpoint)
    revision = reproducibility.get("upstreamRevision")
    if not isinstance(revision, str) or revision != run_request["revision"]:
        raise ValueError("Report and training request disagree about PaddleOCR revision.")
    pooling = reproducibility.get("poolingPolicy")
    if not isinstance(pooling, str) or pooling != training.get("poolingPolicy", "upstream-default"):
        raise ValueError("Report and training record disagree about pooling policy.")
    upstream = Path(run_request["upstream"]).resolve(strict=True)
    verify_upstream(upstream, revision)
    runtime = {
        name: reproducibility.get(name)
        for name in ("numpy", "paddle", "preprocessing", "poolingPolicy")
    }
    if any(
        not isinstance(runtime[name], str) or not runtime[name] for name in ("numpy", "paddle")
    ) or not isinstance(runtime["preprocessing"], dict):
        raise ValueError("The report lacks runtime/preprocessing reproducibility information.")
    return Evidence(
        report_path,
        selected["id"],
        settings,
        raw,
        pooling,
        protected,
        upstream,
        revision,
        runtime,
        run_request,
    ), request["includeShapes"]


def run_diagnostic(request: object, emit, adapter_factory=LdbOcrAdapter) -> dict:
    emit({"type": "status", "message": "보고서와 원본 파일 SHA256 확인 중…"})
    evidence, include_shapes = verify_request(request)
    emit({"type": "status", "message": "기존 로더로 진단 전용 모델을 준비하는 중…"})
    adapter = adapter_factory(evidence.settings)
    if any(adapter.reproducibility.get(name) != value for name, value in evidence.runtime.items()):
        raise ValueError("The selected runtime/preprocessing differs from the saved evaluation.")
    pooling = importlib.import_module("ldb_ocr.training.pooling")
    if pooling.pooling_policy(evidence.run_request) != evidence.pooling_policy:
        raise ValueError("The actual selected pooling policy differs from the saved evaluation.")
    from .diagnostics_observer import input_fingerprint, observe_model_input, preview_stages

    emit({"type": "status", "message": "실제 전처리와 최종 입력을 한 번 관찰하는 중…"})
    model_input, arrays = observe_model_input(adapter, evidence.raw)
    fingerprint = input_fingerprint(arrays["model-input"])
    stages = preview_stages(evidence.raw, arrays)
    shapes = None
    if include_shapes:
        from .diagnostics_shapes import collect_shapes

        emit({"type": "status", "message": "같은 초기 상태에서 train/eval backbone 형태 관찰 중…"})
        shapes = collect_shapes(adapter, model_input)
    if input_fingerprint(model_input.numpy()) != fingerprint:
        raise ValueError("Preview or shape observation changed the actual model input.")
    evidence.verify_unchanged()
    verify_upstream(evidence.upstream, evidence.revision)
    return {
        "reportPath": str(evidence.report_path),
        "sampleId": evidence.sample_id,
        "poolingPolicy": evidence.pooling_policy,
        "inputFingerprint": fingerprint,
        "stages": stages,
        "shapes": shapes,
    }
