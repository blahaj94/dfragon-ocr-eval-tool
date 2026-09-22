import hashlib
import json
import struct
import threading
import zlib
from pathlib import Path

import pytest

from eval_worker.dataset import load_samples
from eval_worker.runner import run_evaluation, settings_from_file

EVENT = "20260922-123456-abcdef12"


def png(width: int = 4, height: int = 2) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress((b"\0" + b"\x80\x80\x80" * width) * height))
        + chunk(b"IEND", b"")
    )


@pytest.fixture
def fixture(tmp_path: Path) -> dict:
    root = tmp_path / "captures"
    event = root / EVENT
    event.mkdir(parents=True)
    metadata = {
        "schemaVersion": 1,
        "eventId": EVENT,
        "coordinateSpace": "primary-monitor-physical-pixels",
        "source": {"width": 100, "height": 100},
        "regions": [
            {"id": index, "file": f"{index:03d}.png", "x": 0, "y": 0, "width": 4, "height": 2}
            for index in (1, 2, 3)
        ],
    }
    (event / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    for index in (1, 2, 3):
        (event / f"{index:03d}.png").write_bytes(png())
    labels = tmp_path / "labels.json"
    labels.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "samples": [
                    {"id": "first", "image": f"{EVENT}/001.png", "truth": "가"},
                    {"id": "second", "image": f"{EVENT}/002.png", "truth": "AＢ"},
                ],
            }
        ),
        encoding="utf-8",
    )
    return {
        "datasetDirectory": str(root),
        "labelsPath": str(labels),
        "outputDirectory": str(tmp_path / "reports"),
        "runDirectory": str(tmp_path / "training"),
        "checkpointPath": str(tmp_path / "training/checkpoints/latest.pdparams"),
        "ldbOcrSourcePath": str(tmp_path / "external-source"),
    }


def mutate_labels(settings: dict, change) -> None:
    path = Path(settings["labelsPath"])
    labels = json.loads(path.read_text(encoding="utf-8"))
    change(labels)
    path.write_text(json.dumps(labels), encoding="utf-8")


class FakeAdapter:
    """The fake isolates orchestration; expected metric behavior is tested in the source project."""

    reproducibility = {"testAdapter": True}

    def __init__(self, settings: dict) -> None:
        self.calls = 0

    def validate_image(self, raw: bytes) -> None:
        if not raw.endswith(b"IEND\xaeB`\x82"):
            raise ValueError("broken PNG")

    def predict(self, raw: bytes) -> tuple[str, float | None]:
        self.calls += 1
        return ("", None) if self.calls == 1 else ("AＢ", 0.01)

    def edit_distance(self, truth: str, prediction: str) -> int:
        return 0 if truth == prediction else len(truth)

    def summarize(self, pairs: list) -> dict:
        distance = sum(self.edit_distance(*pair) for pair in pairs)
        count = sum(truth == prediction for truth, prediction in pairs)
        return {
            "cer": distance / sum(len(truth) for truth, _ in pairs),
            "exactMatch": count / len(pairs),
            "sampleCount": len(pairs),
            "characterCount": sum(len(truth) for truth, _ in pairs),
            "exactMatchCount": count,
            "editDistance": distance,
        }


def test_explicit_subset_unicode_empty_and_low_confidence_are_all_preserved(fixture: dict) -> None:
    before = {
        str(path): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in Path(fixture["datasetDirectory"]).rglob("*")
        if path.is_file()
    }
    events = []
    path, report = run_evaluation(fixture, threading.Event(), events.append, FakeAdapter)
    assert report["status"] == "completed"
    assert report["totalSamples"] == report["processedSamples"] == 2
    assert [sample["prediction"] for sample in report["samples"]] == ["", "AＢ"]
    assert [sample["confidence"] for sample in report["samples"]] == [None, 0.01]
    assert report["summary"]["cer"] == pytest.approx(1 / 3)
    assert report["summary"]["exactMatch"] == 0.5
    assert report["summary"]["characterCount"] == 3
    assert report["partialSummary"] is None
    assert [event["type"] for event in events] == ["started", "progress", "progress", "finished"]
    assert json.loads(path.read_text(encoding="utf-8")) == report
    assert before == {
        str(path): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in Path(fixture["datasetDirectory"]).rglob("*")
        if path.is_file()
    }


def test_cancel_preserves_partial_result_and_has_no_completed_summary(fixture: dict) -> None:
    cancel = threading.Event()
    events = []

    def emit(event: dict) -> None:
        events.append(event)
        if event["type"] == "progress":
            cancel.set()

    _, report = run_evaluation(fixture, cancel, emit, FakeAdapter)
    assert report["status"] == "cancelled"
    assert report["processedSamples"] == 1
    assert report["summary"] is None
    assert report["partialSummary"]["sampleCount"] == 1
    assert events[-1]["report"]["status"] == "cancelled"


def test_pre_cancel_does_not_load_model(fixture: dict) -> None:
    cancel = threading.Event()
    cancel.set()

    def unexpected(settings: dict):
        pytest.fail("Precancelled evaluation must not load the model")

    _, report = run_evaluation(fixture, cancel, lambda _: None, unexpected)
    assert report["status"] == "cancelled"
    assert report["processedSamples"] == 0
    assert report["summary"] is None


def test_failure_after_prediction_retains_sample_and_does_not_claim_success(fixture: dict) -> None:
    class FailsSecond(FakeAdapter):
        def predict(self, raw: bytes):
            if self.calls:
                raise RuntimeError("inference failed")
            return super().predict(raw)

    _, report = run_evaluation(fixture, threading.Event(), lambda _: None, FailsSecond)
    assert report["status"] == "failed"
    assert report["processedSamples"] == 1
    assert report["summary"] is None
    assert report["partialSummary"]["sampleCount"] == 1
    assert "inference failed" in report["error"]


def test_invalid_selected_png_fails_before_first_inference(fixture: dict) -> None:
    image = Path(fixture["datasetDirectory"]) / EVENT / "002.png"
    image.write_bytes(image.read_bytes()[:24])
    _, report = run_evaluation(fixture, threading.Event(), lambda _: None, FakeAdapter)
    assert report["status"] == "failed"
    assert report["processedSamples"] == 0
    assert "broken PNG" in report["error"]


def test_runs_never_overwrite_reports(fixture: dict) -> None:
    first, _ = run_evaluation(fixture, threading.Event(), lambda _: None, FakeAdapter)
    original = first.read_bytes()
    second, _ = run_evaluation(fixture, threading.Event(), lambda _: None, FakeAdapter)
    assert first != second
    assert first.read_bytes() == original


@pytest.mark.parametrize(
    "image",
    [
        "../001.png",
        "/tmp/001.png",
        f"{EVENT}\\001.png",
        f"{EVENT}/original.png",
        f"{EVENT}/004.png",
        f"{EVENT}/../001.png",
        f"{EVENT}//001.png",
        "C:/001.png",
    ],
)
def test_invalid_paths_never_get_skipped(fixture: dict, image: str) -> None:
    mutate_labels(fixture, lambda labels: labels["samples"][0].update(image=image))
    _, report = run_evaluation(fixture, threading.Event(), lambda _: None, FakeAdapter)
    assert report["status"] == "failed"
    assert report["processedSamples"] == 0
    assert report["error"]


@pytest.mark.parametrize("field", ["id", "image"])
def test_duplicates_are_errors(fixture: dict, field: str) -> None:
    mutate_labels(
        fixture, lambda labels: labels["samples"][1].update({field: labels["samples"][0][field]})
    )
    with pytest.raises(ValueError, match="Duplicate"):
        load_samples(Path(fixture["datasetDirectory"]), Path(fixture["labelsPath"]))


def test_orphan_region_and_dimension_mismatch_are_errors(fixture: dict) -> None:
    metadata_path = Path(fixture["datasetDirectory"]) / EVENT / "metadata.json"
    metadata = json.loads(metadata_path.read_text())
    metadata["regions"] = metadata["regions"][1:]
    metadata_path.write_text(json.dumps(metadata))
    with pytest.raises(ValueError, match="not a metadata ROI"):
        load_samples(Path(fixture["datasetDirectory"]), Path(fixture["labelsPath"]))


def test_output_may_not_be_inside_source_data(fixture: dict) -> None:
    fixture["outputDirectory"] = str(Path(fixture["datasetDirectory"]) / "reports")
    with pytest.raises(ValueError, match="outside datasetDirectory"):
        run_evaluation(fixture, threading.Event(), lambda _: None, FakeAdapter)
    assert not Path(fixture["outputDirectory"]).exists()


def test_unknown_settings_and_relative_paths_are_rejected(fixture: dict, tmp_path: Path) -> None:
    request = tmp_path / "request.json"
    request.write_text(json.dumps({**fixture, "fallback": True}))
    with pytest.raises(ValueError, match="fields must be exactly"):
        settings_from_file(request)
    request.write_text(json.dumps({**fixture, "labelsPath": "labels.json"}))
    with pytest.raises(ValueError, match="absolute path"):
        settings_from_file(request)


def test_failed_metrics_still_persist_failure_report(fixture: dict) -> None:
    class BrokenMetrics(FakeAdapter):
        def summarize(self, pairs: list):
            raise RuntimeError("metrics unavailable")

    events = []
    report_path, report = run_evaluation(fixture, threading.Event(), events.append, BrokenMetrics)
    assert report_path.is_file()
    assert report["status"] == "failed"
    assert report["summary"] is None
    assert report["partialSummary"] is None
    assert events[-1]["type"] == "finished"


def test_cli_outputs_jsonl_and_failure_report_without_loading_gpu(
    fixture: dict, tmp_path: Path
) -> None:
    import subprocess
    import sys

    mutate_labels(fixture, lambda labels: labels["samples"][0].update(image="../001.png"))
    request = tmp_path / "request.json"
    request.write_text(json.dumps(fixture), encoding="utf-8")
    result = subprocess.run(
        [sys.executable, str(Path(__file__).parents[1] / "worker.py"), "--request", str(request)],
        input="",
        text=True,
        capture_output=True,
        timeout=10,
    )
    assert result.returncode == 1
    events = [json.loads(line) for line in result.stdout.splitlines()]
    assert [event["type"] for event in events] == ["finished"]
    assert events[0]["report"]["status"] == "failed"
    assert Path(events[0]["reportPath"]).is_file()
