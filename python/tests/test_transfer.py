import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image

from eval_worker.dataset import load_samples
from transfer import transfer

EVENT = "20260922-120000-abcdef12"


@pytest.fixture
def captures(tmp_path: Path) -> Path:
    root = tmp_path / "captures"
    event = root / EVENT
    event.mkdir(parents=True)
    metadata = {
        "schemaVersion": 1,
        "eventId": EVENT,
        "coordinateSpace": "primary-monitor-physical-pixels",
        "source": {"width": 8, "height": 4},
        "regions": [
            {"id": i, "file": f"{i:03d}.png", "x": 0, "y": 0, "width": 4, "height": 2}
            for i in range(1, 5)
        ],
        "groundTruth": {
            "schemaVersion": 1,
            "regions": {"1": " 가😀 e\u0301 ", "2": None, "3": "\ufeff "},
        },
    }
    (event / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    (event / "metadata.json.bak").write_text("Not the current answers", encoding="utf-8")
    for i in range(1, 5):
        Image.new("RGB", (4, 2)).save(event / f"{i:03d}.png")
    Image.new("RGB", (8, 4)).save(event / "original.png")
    return root


def edit(captures: Path, change) -> None:
    path = captures / EVENT / "metadata.json"
    metadata = json.loads(path.read_text(encoding="utf-8"))
    change(metadata)
    path.write_text(json.dumps(metadata), encoding="utf-8")


def test_exports_only_answers_verbatim_and_reuses_evaluation_reader(captures: Path) -> None:
    before = {
        p: hashlib.sha256(p.read_bytes()).hexdigest() for p in captures.rglob("*") if p.is_file()
    }
    result = transfer(captures)
    assert result == {
        "output": str(captures / "labels.json"),
        "events": 1,
        "samples": 1,
        "unanswered": 3,
    }
    samples = load_samples(captures, Path(result["output"]))
    assert [(row.id, row.image, row.truth) for row in samples] == [
        (f"{EVENT}/001", f"{EVENT}/001.png", " 가😀 e\u0301 ")
    ]
    assert all(hashlib.sha256(p.read_bytes()).hexdigest() == digest for p, digest in before.items())


@pytest.mark.parametrize(
    "change",
    [
        lambda m: m.pop("groundTruth"),
        lambda m: m["groundTruth"].update(regions={"1": None}),
    ],
)
def test_no_answers_is_an_error_without_creating_labels(captures: Path, change) -> None:
    edit(captures, change)
    with pytest.raises(ValueError, match="No saved answers"):
        transfer(captures)
    assert not (captures / "labels.json").exists()


@pytest.mark.parametrize(
    "change",
    [
        lambda m: m["groundTruth"].update(schemaVersion=2),
        lambda m: m["groundTruth"].update(schemaVersion=True),
        lambda m: m["groundTruth"]["regions"].update({"999": "unknown"}),
        lambda m: m["groundTruth"]["regions"].update({"01": "ambiguous"}),
        lambda m: m["groundTruth"]["regions"].update({"1": 12}),
        lambda m: m["groundTruth"]["regions"].update({"1": "😀" * 251}),
        lambda m: m.update(eventId="wrong-event"),
    ],
)
def test_invalid_metadata_or_answers_never_silently_drop_a_row(captures: Path, change) -> None:
    edit(captures, change)
    with pytest.raises(ValueError):
        transfer(captures)
    assert not (captures / "labels.json").exists()


@pytest.mark.parametrize("mode", ["missing", "bad-header", "wrong-size"])
def test_bad_labeled_png_blocks_output(captures: Path, mode: str) -> None:
    image = captures / EVENT / "001.png"
    if mode == "missing":
        image.unlink()
    elif mode == "bad-header":
        image.write_bytes(b"not PNG")
    else:
        Image.new("RGB", (2, 2)).save(image)
    with pytest.raises((ValueError, OSError)):
        transfer(captures)
    assert not (captures / "labels.json").exists()


def test_never_overwrites_existing_labels_and_supports_a_new_output(captures: Path) -> None:
    transfer(captures)
    output = captures / "labels.json"
    previous = output.read_bytes()
    edit(captures, lambda m: m["groundTruth"]["regions"].update({"1": "updated"}))
    with pytest.raises(FileExistsError):
        transfer(captures)
    new_output = captures / "labels-new.json"
    transfer(captures, new_output)
    assert output.read_bytes() == previous
    assert load_samples(captures, new_output)[0].truth == "updated"


def test_publish_failure_leaves_no_partial_output(captures: Path, monkeypatch) -> None:
    def fail(*_args):
        raise OSError("disk failure")

    monkeypatch.setattr("transfer.os.link", fail)
    with pytest.raises(OSError, match="disk failure"):
        transfer(captures)
    assert not (captures / "labels.json").exists()
    assert not list(captures.glob(".transfer-*.tmp"))


def test_cli_requires_no_third_party_modules_and_returns_failure_for_existing_output(
    captures: Path,
) -> None:
    command = [sys.executable, "-S", str(Path(__file__).parents[1] / "transfer.py"), str(captures)]
    success = subprocess.run(command, capture_output=True, text=True)
    assert success.returncode == 0, success.stderr
    assert json.loads(success.stdout)["samples"] == 1
    failure = subprocess.run(command, capture_output=True, text=True)
    assert failure.returncode == 1
    assert "Output already exists" in failure.stderr
