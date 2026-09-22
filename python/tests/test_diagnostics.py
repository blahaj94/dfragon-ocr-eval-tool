"""Synthetic observer/lifecycle tests; these never claim real model shape validation."""

import base64
import contextlib
import copy
import io
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

from eval_worker import diagnostics
from eval_worker.adapter import REQUIRED_MODULES, LdbOcrAdapter
from eval_worker.diagnostics_observer import (
    input_fingerprint,
    observe_model_input,
    preview_stages,
)
from eval_worker.diagnostics_shapes import collect_shapes, state_fingerprint


class Tensor:
    def __init__(self, array):
        self.array = np.array(array, copy=True)

    @property
    def shape(self):
        return self.array.shape

    def numpy(self):
        return self.array

    def detach(self):
        return self

    def clone(self):
        return Tensor(self.array)


PADDLE = SimpleNamespace(to_tensor=Tensor, no_grad=contextlib.nullcontext)
RUNTIME = {
    "numpy": np.__version__,
    "paddle": "synthetic-test-runtime",
    "preprocessing": {"version": "synthetic-observer-fixture"},
    "poolingPolicy": "adaptive40",
}


def opaque_png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (3, 2), (17, 43, 91)).save(buffer, format="PNG")
    return buffer.getvalue()


def unusual_preprocessing(raw: bytes):
    """Deliberately unlike production math: proves locals are observed, not recreated."""
    with Image.open(io.BytesIO(raw)) as image:
        rgb = np.asarray(image, dtype=np.float64)
    inverted = np.full(rgb.shape[:2], 13, dtype=np.uint8)  # noqa: F841 - observed frame local
    normalized = np.full(rgb.shape[:2], 0.314, dtype=np.float32)
    output = np.zeros((3, 4, 8), dtype=np.float32)
    output[:, :2, :3] = normalized
    return output, 3 / 8


def adapter(preprocess=unusual_preprocessing):
    value = object.__new__(LdbOcrAdapter)
    value.tensor_from_png = preprocess
    value.paddle = PADDLE
    value.np = np
    value.reproducibility = copy.deepcopy(RUNTIME)
    return value


def test_observed_input_exactly_matches_plain_adapter_and_preview_never_mutates_it():
    value = adapter()
    raw = opaque_png()
    plain = value.model_input(raw).numpy().copy()
    profile_calls = []

    def existing_profile(frame, event, result):
        if frame.f_code is unusual_preprocessing.__code__:
            profile_calls.append(event)

    previous = sys.getprofile()
    try:
        sys.setprofile(existing_profile)
        observed, arrays = observe_model_input(value, raw)
        assert sys.getprofile() is existing_profile
    finally:
        sys.setprofile(previous)
    assert profile_calls.count("return") == 1
    assert plain.dtype == observed.numpy().dtype
    np.testing.assert_array_equal(plain, observed.numpy())
    np.testing.assert_array_equal(arrays["inverted"], np.full((2, 3), 13, dtype=np.uint8))
    np.testing.assert_array_equal(arrays["normalized"], np.full((2, 3), 0.314, dtype=np.float32))
    copies = {name: array.copy() for name, array in arrays.items()}
    fingerprint = input_fingerprint(observed.numpy())
    stages = preview_stages(raw, arrays)
    assert len(stages) == 5
    for stage in stages:
        with Image.open(
            io.BytesIO(base64.b64decode(stage["previewUrl"].split(",", 1)[1]))
        ) as image:
            assert image.size == (stage["imageWidth"], stage["imageHeight"])
    assert stages[-1]["shape"] == [1, 3, 4, 8]
    assert stages[-1]["contentBounds"] == {"x": 0, "y": 0, "width": 3, "height": 2}
    assert stages[2]["minimum"] == stages[2]["maximum"]
    assert "상수 배열" in stages[2]["previewNote"]
    assert stages[0]["previewUrl"].endswith(base64.b64encode(raw).decode())
    assert input_fingerprint(observed.numpy()) == fingerprint
    for name, before in copies.items():
        np.testing.assert_array_equal(arrays[name], before)


def test_observer_restores_profiler_after_preprocessing_failure():
    def broken(raw):
        raise ValueError("opaque input rejected")

    previous = sys.getprofile()
    with pytest.raises(ValueError, match="opaque input rejected"):
        observe_model_input(adapter(broken), opaque_png())
    assert sys.getprofile() is previous


def test_model_input_extraction_keeps_predict_on_the_shared_path():
    value = adapter()
    calls = []
    value.model = lambda actual: calls.append(actual.numpy().copy()) or Tensor([[[1]]])
    value.decode_output = lambda output, classes: "fixture prediction"
    value.classes = [None, "가"]
    assert value.predict(opaque_png()) == ("fixture prediction", None)
    assert len(calls) == 1
    np.testing.assert_array_equal(calls[0], value.model_input(opaque_png()).numpy())


def test_fingerprint_includes_actual_dtype_shape_and_values():
    original = np.array([[1, 2]], dtype=np.float32)
    fingerprints = {
        input_fingerprint(original),
        input_fingerprint(original.astype(np.float64)),
        input_fingerprint(original.reshape(2, 1)),
        input_fingerprint(original + 1),
    }
    assert len(fingerprints) == 4


class Handle:
    def __init__(self, collection, hook):
        self.collection = collection
        self.hook = hook
        collection.append(hook)

    def remove(self):
        self.collection.remove(self.hook)


class Layer:
    def __init__(self):
        self.training = False
        self.pre_hooks = []
        self.post_hooks = []

    def register_forward_pre_hook(self, hook):
        return Handle(self.pre_hooks, hook)

    def register_forward_post_hook(self, hook):
        return Handle(self.post_hooks, hook)


class Backbone(Layer):
    def __init__(self, fail_train=False):
        super().__init__()
        self.blocks6 = Layer()
        self.buffer = Tensor([0.0])
        self.starts = []
        self.fail_train = fail_train

    def sublayers(self):
        return [self.blocks6]

    def state_dict(self):
        return {"running_mean": self.buffer}

    def set_state_dict(self, state):
        self.buffer = state["running_mean"].clone()

    def train(self):
        self.training = self.blocks6.training = True

    def eval(self):
        self.training = self.blocks6.training = False

    def __call__(self, image):
        self.starts.append(float(self.buffer.numpy()[0]))
        assert self.training is self.blocks6.training
        for hook in self.pre_hooks:
            assert hook(self, (image,)) is None
        if self.training:
            self.buffer.array += 7  # A real training-mode BatchNorm similarly changes buffers.
            if self.fail_train:
                raise RuntimeError("synthetic training forward failed")
        intermediate = Tensor(np.zeros((1, 4, 3, 7), dtype=np.float32))
        for hook in self.blocks6.post_hooks:
            assert hook(self.blocks6, (image,), intermediate) is None
        result = Tensor(np.zeros((1, 4, 1, 5 if self.training else 7), dtype=np.float32))
        for hook in self.post_hooks:
            assert hook(self, (image,), result) is None
        return result


@pytest.mark.parametrize("fail_train", [False, True])
def test_shape_modes_restore_identical_state_and_remove_hooks_even_after_failure(fail_train):
    backbone = Backbone(fail_train)
    value = adapter()
    value.model = SimpleNamespace(backbone=backbone, use_transform=False)
    before = state_fingerprint(backbone.state_dict())
    model_input = value.model_input(opaque_png())
    result = collect_shapes(value, model_input, validate_backbone=lambda model: None)
    assert backbone.starts == [0, 0]
    assert state_fingerprint(backbone.state_dict()) == before
    assert not backbone.training and not backbone.blocks6.training
    assert not backbone.pre_hooks and not backbone.post_hooks and not backbone.blocks6.post_hooks
    assert result[0]["evaluation"]["shape"] == list(model_input.shape)
    assert result[1]["evaluation"]["shape"] == [1, 4, 3, 7]
    assert result[2]["evaluation"]["shape"] == [1, 4, 1, 7]
    if fail_train:
        assert all(row["train"]["shape"] is None for row in result)
        assert all("synthetic training forward failed" in row["train"]["error"] for row in result)
    else:
        assert result[2]["train"]["shape"] == [1, 4, 1, 5]


def test_transform_and_unknown_backbone_do_not_fabricate_shape_measurements():
    value = adapter()
    backbone = Backbone()
    value.model = SimpleNamespace(backbone=backbone, use_transform=True)
    result = collect_shapes(value, value.model_input(opaque_png()))
    assert all(
        row["train"]["shape"] is None and row["evaluation"]["shape"] is None for row in result
    )
    assert "Transform" in result[0]["train"]["error"]
    assert not backbone.starts
    value.model.use_transform = False
    result = collect_shapes(value, value.model_input(opaque_png()))
    assert "no verified" in result[0]["train"]["error"]


@pytest.fixture
def evidence(tmp_path, monkeypatch):
    run = tmp_path / "run"
    checkpoint = run / "checkpoints/latest.pdparams"
    checkpoint.parent.mkdir(parents=True)
    checkpoint.write_bytes(b"synthetic checkpoint; not a model")
    source = tmp_path / "source"
    hashes = {}
    for name in REQUIRED_MODULES:
        path = source / "python/src/ldb_ocr" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"# Synthetic file for SHA validation: {name}\n")
        hashes[name] = diagnostics.sha256(path)
    upstream = tmp_path / "upstream"
    (upstream / "ppocr").mkdir(parents=True)
    dictionary = run / "characters.txt"
    dictionary.write_text("가\n", encoding="utf-8")
    config = run / "config.yml"
    config.write_text("Global: {}\n")
    training_request = {
        "run": str(run),
        "dictionary": str(dictionary),
        "dictionarySha256": diagnostics.sha256(dictionary),
        "manifestSha256": "a" * 64,
        "upstream": str(upstream),
        "revision": "b" * 40,
        "useSpace": True,
        "model": "v5-korean",
        "profile": "korean",
        "imageStage": "raw-nickname-crop",
    }
    (run / "request.json").write_text(json.dumps(training_request))
    (run / "training.json").write_text(
        json.dumps(
            {
                "checkpointFiles": {"latest.pdparams": diagnostics.sha256(checkpoint)},
                "poolingPolicy": "adaptive40",
            }
        )
    )
    root = tmp_path / "captures"
    root.mkdir()
    image = root / "crop.png"
    image.write_bytes(opaque_png())
    settings = {
        "runDirectory": str(run),
        "checkpointPath": str(checkpoint),
        "datasetDirectory": str(root),
        "labelsPath": str(tmp_path / "labels-do-not-exist.json"),
        "outputDirectory": str(tmp_path / "never-created"),
        "ldbOcrSourcePath": str(source),
    }
    repro = {
        **RUNTIME,
        "settings": settings,
        "normalization": "none",
        "batchSize": 1,
        "sourceSha256": hashes,
        "upstreamRevision": "b" * 40,
    }
    for name, path in {
        "checkpointSha256": checkpoint,
        "dictionarySha256": dictionary,
        "configSha256": config,
        "requestSha256": run / "request.json",
        "trainingReportSha256": run / "training.json",
    }.items():
        repro[name] = diagnostics.sha256(path)
    report = {
        "schemaVersion": 1,
        "status": "completed",
        "totalSamples": 1,
        "processedSamples": 1,
        "summary": {"sampleCount": 1},
        "error": None,
        "samples": [
            {"id": "sample", "imagePath": str(image), "imageSha256": diagnostics.sha256(image)}
        ],
        "reproducibility": repro,
    }
    path = tmp_path / "report.json"
    path.write_text(json.dumps(report))
    request = {
        "reportPath": str(path),
        "reportSha256": diagnostics.sha256(path),
        "sampleId": "sample",
        "includeShapes": False,
    }
    monkeypatch.setattr(diagnostics, "verify_upstream", lambda directory, revision: None)
    monkeypatch.setattr(
        diagnostics, "SUPPORTED_PREPROCESSING_SHA256", hashes["training/preprocessing.py"]
    )
    monkeypatch.setitem(
        sys.modules,
        "ldb_ocr.training.pooling",
        SimpleNamespace(pooling_policy=lambda request: "adaptive40"),
    )
    return request, report, tmp_path


def update_report(request, report):
    path = Path(request["reportPath"])
    path.write_text(json.dumps(report))
    request["reportSha256"] = diagnostics.sha256(path)


def test_diagnostic_uses_saved_evidence_without_labels_metadata_or_writes(evidence):
    request, report, root = evidence
    before = {str(path): path.read_bytes() for path in root.rglob("*") if path.is_file()}
    events = []
    result = diagnostics.run_diagnostic(request, events.append, lambda settings: adapter())
    assert result["sampleId"] == "sample" and result["shapes"] is None
    assert len(result["stages"]) == 5
    assert all(event["type"] == "status" for event in events)
    assert not Path(report["reproducibility"]["settings"]["labelsPath"]).exists()
    assert {str(path): path.read_bytes() for path in root.rglob("*") if path.is_file()} == before


@pytest.mark.parametrize("status", ["cancelled", "failed"])
def test_evaluated_partial_samples_keep_provenance_and_can_be_observed(evidence, status):
    request, report, _ = evidence
    report.update(
        status=status,
        totalSamples=3,
        summary=None,
        error="interrupted" if status == "failed" else None,
    )
    update_report(request, report)
    result = diagnostics.run_diagnostic(request, lambda event: None, lambda settings: adapter())
    assert result["sampleId"] == "sample"


@pytest.mark.parametrize(
    "name", ["report", "image", "source", "checkpoint", "dictionary", "config", "training"]
)
def test_changed_report_and_all_protected_inputs_are_rejected_before_model_load(evidence, name):
    request, report, root = evidence
    paths = {
        "report": Path(request["reportPath"]),
        "image": Path(report["samples"][0]["imagePath"]),
        "source": root / "source/python/src/ldb_ocr/training/preprocessing.py",
        "checkpoint": root / "run/checkpoints/latest.pdparams",
        "dictionary": root / "run/characters.txt",
        "config": root / "run/config.yml",
        "training": root / "run/training.json",
    }
    path = paths[name]
    path.write_bytes(path.read_bytes() + b" ")
    with pytest.raises(ValueError, match="changed|differs"):
        diagnostics.run_diagnostic(
            request, lambda event: None, lambda settings: pytest.fail("must not load model")
        )


def test_ambiguous_sample_and_runtime_changes_are_rejected(evidence):
    request, report, _ = evidence
    report["samples"].append(copy.deepcopy(report["samples"][0]))
    report.update(totalSamples=2, processedSamples=2)
    update_report(request, report)
    with pytest.raises(ValueError, match="unique"):
        diagnostics.verify_request(request)
    report["samples"].pop()
    report.update(totalSamples=1, processedSamples=1)
    update_report(request, report)
    value = adapter()
    value.reproducibility["numpy"] = "changed"
    with pytest.raises(ValueError, match="runtime/preprocessing"):
        diagnostics.run_diagnostic(request, lambda event: None, lambda settings: value)


def test_missing_png_fails_before_model_load_without_fallback(evidence):
    request, report, _ = evidence
    Path(report["samples"][0]["imagePath"]).unlink()
    with pytest.raises(FileNotFoundError):
        diagnostics.run_diagnostic(
            request, lambda event: None, lambda settings: pytest.fail("must not load model")
        )


def test_unverified_preprocessing_order_is_rejected_even_with_self_consistent_hashes(
    evidence, monkeypatch
):
    request, _, _ = evidence
    monkeypatch.setattr(diagnostics, "SUPPORTED_PREPROCESSING_SHA256", "f" * 64)
    with pytest.raises(ValueError, match="stage order has not been verified"):
        diagnostics.verify_request(request)


def test_actual_pooling_policy_is_checked_against_saved_report(evidence, monkeypatch):
    request, _, _ = evidence
    monkeypatch.setitem(
        sys.modules,
        "ldb_ocr.training.pooling",
        SimpleNamespace(pooling_policy=lambda request: "different-policy"),
    )
    with pytest.raises(ValueError, match="actual selected pooling policy"):
        diagnostics.run_diagnostic(request, lambda event: None, lambda settings: adapter())


def test_cli_failure_is_jsonl_and_does_not_start_model_or_write_outputs(tmp_path):
    request = tmp_path / "request.json"
    request.write_text("{}")
    result = subprocess.run(
        [
            sys.executable,
            "-B",
            str(Path(__file__).parents[1] / "diagnostic_worker.py"),
            "--request",
            str(request),
        ],
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 1
    events = [json.loads(line) for line in result.stdout.splitlines()]
    assert [event["type"] for event in events] == ["status", "error"]
    assert list(tmp_path.iterdir()) == [request]
