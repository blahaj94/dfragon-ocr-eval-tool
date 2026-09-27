import json
from pathlib import Path

import pytest
from PIL import Image

from training_worker.runner import validate_options
from training_worker.snapshot import digest, load_snapshot

CAPTURE = "00000000-0000-4000-8000-000000000001"


def save_dataset(root: Path, value: dict) -> None:
    (root / "dataset.json").write_text(json.dumps(value), encoding="utf-8")
    (root / "ready.json").write_text(
        json.dumps({"datasetSha256": digest(root / "dataset.json")}), encoding="utf-8"
    )


@pytest.fixture
def snapshot(tmp_path):
    (tmp_path / "model").mkdir()
    (tmp_path / "images").mkdir()
    (tmp_path / "model/characters.txt").write_text("가\n나\n다\n", encoding="utf-8")
    (tmp_path / "model/weights.pdparams").write_bytes(b"synthetic weights; not executed")
    files = [
        {
            "name": name,
            "bytes": (tmp_path / "model" / name).stat().st_size,
            "sha256": digest(tmp_path / "model" / name),
        }
        for name in ("weights.pdparams", "characters.txt")
    ]
    (tmp_path / "model/model.json").write_text(
        json.dumps({"id": CAPTURE, "preset": "korean-ppocrv5", "files": files}), encoding="utf-8"
    )
    rows = []
    for slot, (split, text) in enumerate(
        zip(("train", "val", "test"), ("가", "나", "다"), strict=True), 1
    ):
        sample_id = f"{CAPTURE}-{slot}"
        path = tmp_path / f"images/{sample_id}.png"
        Image.new("RGB", (8, 4), (slot * 40, 50, 90)).save(path)
        rows.append(
            {
                "id": sample_id,
                "captureId": CAPTURE,
                "slot": slot,
                "image": f"images/{sample_id}.png",
                "width": 8,
                "height": 4,
                "text": text,
                "excluded": False,
                "split": split,
                "sha256": digest(path),
            }
        )
    value = {
        "schemaVersion": 1,
        "modelId": CAPTURE,
        "counts": {"train": 1, "val": 1, "test": 1, "skipped": 0},
        "samples": rows,
    }
    save_dataset(tmp_path, value)
    return tmp_path, value


def test_server_nickname_splits_survive_mixed_capture_without_changing_input(snapshot):
    root, value = snapshot
    before = digest(root / "dataset.json")
    dataset, _, warnings = load_snapshot(root)
    assert [row["split"] for row in dataset["samples"]] == ["train", "val", "test"]
    assert len(warnings) == 1
    assert digest(root / "dataset.json") == before


@pytest.mark.parametrize(
    "target",
    ["dataset.json", "model/weights.pdparams", "model/characters.txt", f"images/{CAPTURE}-1.png"],
)
def test_modified_inputs_are_rejected_before_loading_gpu(snapshot, target):
    root, _ = snapshot
    with (root / target).open("ab") as stream:
        stream.write(b"modified")
    with pytest.raises(ValueError):
        load_snapshot(root)


def test_same_pixels_with_different_png_encoding_cannot_cross_splits(snapshot):
    root, value = snapshot
    first, second = value["samples"][:2]
    with Image.open(root / first["image"]) as image:
        image.save(root / second["image"], compress_level=0)
    second["sha256"] = digest(root / second["image"])
    assert first["sha256"] != second["sha256"]
    save_dataset(root, value)
    with pytest.raises(ValueError, match="Identical decoded pixels"):
        load_snapshot(root)


@pytest.mark.parametrize(
    "change",
    ["same-label", "excluded", "unassigned", "unknown-character", "path-escape", "missing-test"],
)
def test_invalid_training_selection_fails_without_silent_skips(snapshot, change):
    root, value = snapshot
    row = value["samples"][1]
    if change == "same-label":
        row["text"] = "가"
    if change == "excluded":
        row["excluded"] = True
    if change == "unassigned":
        row["split"] = "unassigned"
    if change == "unknown-character":
        row["text"] = "힣"
    if change == "path-escape":
        row["image"] = "../outside.png"
    if change == "missing-test":
        value["samples"].pop()
    save_dataset(root, value)
    with pytest.raises(ValueError):
        load_snapshot(root)


@pytest.mark.parametrize(
    "field,value",
    [
        ("epochs", True),
        ("epochs", 0),
        ("batchSize", 129),
        ("learningRate", float("nan")),
        ("learningRate", 0),
    ],
)
def test_training_options_reject_unbounded_or_invalid_runs(field, value, tmp_path):
    options = {
        "epochs": 1,
        "batchSize": 2,
        "learningRate": 0.00001,
        "directory": str(tmp_path),
        "runDirectory": str(tmp_path),
        "upstreamDirectory": str(tmp_path),
    }
    options[field] = value
    with pytest.raises(ValueError):
        validate_options(options)
