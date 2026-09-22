import copy
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image

from dataset_check import check_dataset, pixel_identity, sample_key

EVENTS = [f"20260922-12000{index}-abcdef0{index}" for index in range(1, 7)]
CONFIRMED = "2026-09-22T12:00:00Z"


def empty_record() -> dict:
    return {"schemaVersion": 1, "selection": None, "samples": []}


def request(selection: dict, *, record=None, mode="load", assignments=None) -> dict:
    return {
        "mode": mode,
        "record": empty_record() if record is None else record,
        "selection": selection,
        "assignments": {} if assignments is None else assignments,
    }


def as_record(selection: dict, result: dict, confirmed=False) -> dict:
    samples = copy.deepcopy(result["samples"])
    if confirmed:
        for sample in samples:
            if sample["split"] is not None:
                sample["confirmedAt"] = CONFIRMED
    return {"schemaVersion": 1, "selection": selection, "samples": samples}


@pytest.fixture
def captures(tmp_path: Path):
    def create(name: str, specs: list[dict]) -> dict:
        root = tmp_path / name
        root.mkdir()
        rows = []
        for index, spec in enumerate(specs, 1):
            event_id = spec.get("event", EVENTS[index - 1])
            event = root / event_id
            event.mkdir()
            metadata = {
                "schemaVersion": 1,
                "eventId": event_id,
                "capturedAt": "2026-09-22T12:00:00Z",
                "coordinateSpace": "primary-monitor-physical-pixels",
                "source": {
                    "width": 8,
                    "height": 4,
                    "pixelFormat": "rgba8",
                    "backend": "fixture",
                    "rgbaSha256": hashlib.sha256(
                        Image.new(
                            "RGBA", (8, 4), (spec.get("original_color", index), 9, 8, 255)
                        ).tobytes()
                    ).hexdigest(),
                    "file": "original.png" if spec.get("original") else None,
                },
                "regions": [],
            }
            if spec.get("original"):
                Image.new("RGBA", (8, 4), (spec.get("original_color", index), 9, 8, 255)).save(
                    event / "original.png"
                )
            for region_id, color in enumerate(spec.get("colors", [index * 30]), 1):
                mode = spec.get("mode", "RGB")
                rgb = (color, 20, 80)
                image = Image.new(mode, (4, 2), (*rgb, 255) if mode == "RGBA" else rgb)
                image.save(
                    event / f"{region_id:03d}.png", compress_level=spec.get("compression", 6)
                )
                metadata["regions"].append(
                    {
                        "id": region_id,
                        "x": region_id - 1,
                        "y": 0,
                        "width": 4,
                        "height": 2,
                        "file": f"{region_id:03d}.png",
                    }
                )
                rows.append(
                    {
                        "id": spec.get("id", f"{name}-{index}-{region_id}"),
                        "image": f"{event_id}/{region_id:03d}.png",
                        "truth": spec.get("truth", "가"),
                    }
                )
            (event / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
        labels = root / "labels.json"
        labels.write_text(json.dumps({"schemaVersion": 1, "samples": rows}), encoding="utf-8")
        return {
            "pythonExecutable": str(Path(sys.executable).resolve()),
            "datasetDirectory": str(root.resolve()),
            "labelsPath": str(labels.resolve()),
        }

    return create


def codes(result: dict) -> set[str]:
    return {item["code"] for item in result["issues"]}


def test_load_and_assign_normal_dataset_with_unassigned_excluded_from_leakage(captures) -> None:
    selection = captures("normal", [{"colors": [1, 2]}, {"colors": [3]}, {"colors": [4]}])
    loaded = check_dataset(request(selection))
    assert loaded["passed"]
    assert loaded["counts"] == {"train": 0, "val": 0, "test": 0, "unassigned": 4}
    assert all(row["split"] is None and row["confirmedAt"] is None for row in loaded["samples"])
    result = check_dataset(
        request(
            selection,
            record=as_record(selection, loaded),
            mode="check",
            assignments={EVENTS[0]: "train", EVENTS[1]: "val", EVENTS[2]: "test"},
        )
    )
    assert result["passed"]
    assert result["counts"] == {"train": 2, "val": 1, "test": 1, "unassigned": 0}
    first = result["samples"][0]
    assert first["key"] == sample_key(selection["datasetDirectory"], first["image"])


@pytest.mark.parametrize(
    "split,passed,code",
    [
        ("val", False, "PIXEL_SPLIT_LEAKAGE"),
        ("train", True, "DUPLICATE_PIXELS_IN_SPLIT"),
        (None, True, None),
    ],
)
def test_decoded_duplicates_ignore_png_mode_compression_and_event_name(
    captures, split, passed, code
) -> None:
    selection = captures(
        "duplicates",
        [
            {"colors": [66], "mode": "RGB", "compression": 0},
            {"colors": [66], "mode": "RGBA", "compression": 9},
        ],
    )
    result = check_dataset(
        request(selection, mode="check", assignments={EVENTS[0]: "train", EVENTS[1]: split})
    )
    assert result["passed"] is passed
    assert result["samples"][0]["pixelHash"] == result["samples"][1]["pixelHash"]
    if code:
        assert code in codes(result)
        assert next(item for item in result["issues"] if item["code"] == code)["severity"] == (
            "warning" if passed else "error"
        )
    else:
        assert not result["issues"]


def test_same_original_groups_different_events_with_distinct_roi_pixels(captures) -> None:
    selection = captures(
        "same-original",
        [
            {"colors": [31], "original_color": 4},
            {"colors": [71], "original_color": 4},
        ],
    )
    result = check_dataset(
        request(selection, mode="check", assignments={EVENTS[0]: "train", EVENTS[1]: "test"})
    )
    assert not result["passed"]
    assert "ORIGINAL_SPLIT_LEAKAGE" in codes(result)
    assert "PIXEL_SPLIT_LEAKAGE" not in codes(result)


def test_original_file_is_decoded_verified_and_can_supply_missing_legacy_hash(captures) -> None:
    selection = captures("original", [{"colors": [3], "original": True, "original_color": 2}])
    event = Path(selection["datasetDirectory"]) / EVENTS[0]
    metadata_path = event / "metadata.json"
    metadata = json.loads(metadata_path.read_text())
    expected = pixel_identity(8, 4, metadata["source"]["rgbaSha256"])
    del metadata["source"]["rgbaSha256"]
    metadata_path.write_text(json.dumps(metadata))
    result = check_dataset(request(selection))
    assert result["passed"]
    assert result["samples"][0]["originalHash"] == expected
    metadata["source"]["rgbaSha256"] = "f" * 64
    metadata_path.write_text(json.dumps(metadata))
    failed = check_dataset(request(selection))
    assert not failed["passed"]
    assert "INVALID_IMAGE_OR_SOURCE" in codes(failed)


def test_persisted_confirmed_hash_detects_renamed_duplicate_and_preserves_all_roots(
    captures,
) -> None:
    older = captures("older", [{"colors": [77]}])
    original = check_dataset(request(older, mode="check", assignments={EVENTS[0]: "train"}))
    record = as_record(older, original, confirmed=True)
    record_before = copy.deepcopy(record)
    newer = captures("newer", [{"colors": [77], "event": EVENTS[3], "original_color": 8}])
    result = check_dataset(
        request(newer, record=record, mode="check", assignments={EVENTS[3]: "val"})
    )
    assert not result["passed"]
    assert "PIXEL_SPLIT_LEAKAGE" in codes(result)
    assert result["samples"][0] == record["samples"][0]
    assert record == record_before
    assert result["counts"] == {"train": 0, "val": 1, "test": 0, "unassigned": 0}
    # A moved-away old file cannot erase its persisted fingerprint evidence.
    (Path(older["datasetDirectory"]) / EVENTS[0] / "001.png").unlink()
    missing = check_dataset(
        request(newer, record=record, mode="check", assignments={EVENTS[3]: "val"})
    )
    assert {"PIXEL_SPLIT_LEAKAGE", "INVALID_STORED_SAMPLE"}.issubset(codes(missing))
    assert missing["samples"][0] == record["samples"][0]


def test_event_identity_is_global_even_without_source_hash(captures) -> None:
    older = captures("event-a", [{"colors": [22]}])
    newer = captures("event-b", [{"colors": [99], "original_color": 4}])
    for selection in (older, newer):
        path = Path(selection["datasetDirectory"]) / EVENTS[0] / "metadata.json"
        metadata = json.loads(path.read_text())
        del metadata["source"]["rgbaSha256"]
        path.write_text(json.dumps(metadata))
    checked = check_dataset(request(older, mode="check", assignments={EVENTS[0]: "train"}))
    result = check_dataset(
        request(
            newer,
            record=as_record(older, checked, True),
            mode="check",
            assignments={EVENTS[0]: "test"},
        )
    )
    assert not result["passed"]
    assert "CAPTURE_SPLIT_LEAKAGE" in codes(result)
    assert all(row["originalHash"] is None for row in result["samples"])


def test_confirmed_truth_and_pixels_are_frozen_but_optional_metadata_annotations_may_change(
    captures,
) -> None:
    selection = captures("frozen", [{"colors": [31]}])
    checked = check_dataset(request(selection, mode="check", assignments={EVENTS[0]: "train"}))
    record = as_record(selection, checked, confirmed=True)
    path = Path(selection["datasetDirectory"]) / EVENTS[0] / "metadata.json"
    metadata = json.loads(path.read_text())
    metadata["groundTruth"] = {"schemaVersion": 1, "regions": {"1": "unrelated annotation"}}
    path.write_text(json.dumps(metadata))
    same = check_dataset(
        request(selection, record=record, mode="check", assignments={EVENTS[0]: "test"})
    )
    assert same["passed"] and same["samples"] == record["samples"]
    labels = json.loads(Path(selection["labelsPath"]).read_text())
    labels["samples"][0]["truth"] = "changed"
    Path(selection["labelsPath"]).write_text(json.dumps(labels))
    changed = check_dataset(request(selection, record=record))
    assert not changed["passed"]
    assert "CONFIRMED_SAMPLE_CHANGED" in codes(changed)
    assert changed["samples"] == record["samples"]


def test_merged_active_ids_cannot_reuse_an_older_confirmed_id(captures) -> None:
    selection = captures(
        "same-root", [{"colors": [11], "id": "stable"}, {"colors": [22], "id": "later"}]
    )
    labels_path = Path(selection["labelsPath"])
    full_labels = json.loads(labels_path.read_text())
    labels_path.write_text(json.dumps({"schemaVersion": 1, "samples": full_labels["samples"][:1]}))
    first = check_dataset(request(selection, mode="check", assignments={EVENTS[0]: "train"}))
    record = as_record(selection, first, confirmed=True)
    new_row = full_labels["samples"][1]
    new_row["id"] = "stable"
    labels_path.write_text(json.dumps({"schemaVersion": 1, "samples": [new_row]}))
    result = check_dataset(request(selection, record=record))
    assert not result["passed"]
    assert "DUPLICATE_ACTIVE_IDENTITY" in codes(result)
    assert result["samples"][0] == record["samples"][0]


@pytest.mark.parametrize("confirmed", [False, True])
def test_omitted_historical_row_blocks_only_pending_assignment(captures, confirmed) -> None:
    selection = captures("omitted", [{"colors": [11]}, {"colors": [22]}])
    loaded = check_dataset(request(selection, mode="check", assignments={EVENTS[0]: "train"}))
    record = as_record(selection, loaded, confirmed=confirmed)
    labels_path = Path(selection["labelsPath"])
    labels = json.loads(labels_path.read_text())
    labels["samples"] = labels["samples"][1:]
    labels_path.write_text(json.dumps(labels))

    result = check_dataset(
        request(selection, record=record, mode="check", assignments={EVENTS[0]: "train"})
    )
    assert result["samples"][0] == record["samples"][0]
    assert result["passed"] is confirmed
    assert ("PENDING_SAMPLE_MISSING_FROM_LABELS" in codes(result)) is (not confirmed)

    if not confirmed:
        unassigned = check_dataset(
            request(selection, record=record, mode="check", assignments={EVENTS[0]: None})
        )
        assert unassigned["passed"]
        assert len(unassigned["samples"]) == 2
        assert unassigned["samples"][0]["split"] is None


@pytest.mark.parametrize("damage", ["missing", "broken", "label", "dimensions"])
def test_bad_inputs_never_silently_pass(captures, damage) -> None:
    selection = captures("bad", [{"colors": [22]}])
    image = Path(selection["datasetDirectory"]) / EVENTS[0] / "001.png"
    if damage == "missing":
        image.unlink()
    elif damage == "broken":
        image.write_bytes(image.read_bytes()[:24])
    elif damage == "dimensions":
        Image.new("RGB", (6, 2)).save(image)
    else:
        Path(selection["labelsPath"]).write_text(
            '{"schemaVersion":1,"samples":[{"image":"../bad.png"}]}'
        )
    result = check_dataset(request(selection))
    assert not result["passed"]
    assert result["issues"][0]["severity"] == "error"


def test_existing_other_root_pending_row_is_not_reassigned(captures) -> None:
    older = captures("pending-old", [{"colors": [22]}])
    loaded = check_dataset(request(older))
    record = as_record(older, loaded)
    newer = captures("pending-new", [{"colors": [33], "event": EVENTS[3]}])
    result = check_dataset(
        request(newer, record=record, mode="check", assignments={EVENTS[3]: "test"})
    )
    assert result["passed"]
    assert result["samples"][0] == record["samples"][0]
    assert result["samples"][1]["split"] == "test"


def test_malformed_persisted_record_cannot_be_accepted(captures) -> None:
    selection = captures("record", [{"colors": [22]}])
    loaded = check_dataset(request(selection))
    record = as_record(selection, loaded)
    record["samples"][0]["key"] = "0" * 64
    with pytest.raises(ValueError, match="sample key"):
        check_dataset(request(selection, record=record))


def test_cli_produces_one_json_document_and_never_changes_capture_files(captures) -> None:
    selection = captures("cli", [{"colors": [22]}])
    root = Path(selection["datasetDirectory"])
    before = {str(path): path.read_bytes() for path in root.rglob("*") if path.is_file()}
    result = subprocess.run(
        [sys.executable, str(Path(__file__).parents[1] / "dataset_check.py")],
        input=json.dumps(request(selection)),
        text=True,
        capture_output=True,
        timeout=10,
    )
    assert result.returncode == 0 and result.stderr == ""
    output = json.loads(result.stdout)
    assert output["passed"] and len(result.stdout.splitlines()) == 1
    assert before == {str(path): path.read_bytes() for path in root.rglob("*") if path.is_file()}
    invalid = subprocess.run(
        [sys.executable, str(Path(__file__).parents[1] / "dataset_check.py")],
        input='{"mode":"load","mode":"check"}',
        text=True,
        capture_output=True,
        timeout=10,
    )
    assert invalid.returncode != 0
    assert json.loads(invalid.stdout)["passed"] is False
