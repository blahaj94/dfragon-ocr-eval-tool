import copy
import json
import random
import sys
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest
from PIL import Image
from test_training_snapshot import snapshot as snapshot

from training_worker.dictionary import expand_state_arrays, extend_characters, write_run_dictionary
from training_worker.snapshot import digest, load_snapshot
from training_worker.supplement import composite, prepare_supplement
from training_worker.supplement_plan import GROUPS, character_group, distribution, plan_supplement
from training_worker.supplement_snapshot import load_supplement


def valid(text):
    try:
        good = 0 < len(text.encode("cp949")) <= 12 and not any(c.isspace() for c in text)
    except UnicodeEncodeError:
        good = False
    return SimpleNamespace(is_valid=good, reason="invalid test nickname")


def options(**overrides):
    value = {
        "pythonExecutable": "/fixture/python",
        "additionalCharacters": "ABCD",
        "targets": dict.fromkeys(GROUPS, None),
        "characters": dict.fromkeys(GROUPS, ""),
        "tolerance": 0,
        "maxImages": 1000,
        "seed": 42,
        "profile": "nanum-neo",
        "fonts": dict.fromkeys(("gulim", "batang", "nanum", "uttum"), ""),
        "scale": 1,
        "width": 40,
        "height": 20,
        "padding": 1,
        "color": [75, 209, 255],
        "backgroundMode": "solid",
        "backgroundColor": [20, 40, 60],
        "backgroundDirectory": "",
    }
    value.update(overrides)
    return value


def test_character_counts_and_balanced_unique_names_use_only_selected_shortages():
    assert [character_group(char) for char in "ⓐ⒜Ⅰⅰ"] == ["special", "special", "latin", "latin"]
    assert distribution(["가", "가"])["nicknames"] == 1
    assert distribution(["검사★龍", "あアA2Ω"])["groups"] == dict(
        zip(GROUPS, (2, 1, 1, 1, 1, 1, 1, 1))
    )
    rows = [{"text": "가나다라마바", "split": "train"} for _ in range(100)] + [
        {"text": "★☆", "split": "test"}
    ]
    config = options()
    config["targets"]["special"] = 20
    config["characters"]["special"] = "★☆♥♡◆◇○●◎"
    before = copy.deepcopy(rows)
    plan = plan_supplement(rows, config, valid)
    assert plan == plan_supplement(rows, config, valid)
    assert rows == before
    assert plan["real"]["images"] == 100
    assert abs(plan["differences"]["special"]) < 1e-8
    assert len(set(plan["nicknames"])) == len(plan["nicknames"])
    assert "★☆" not in plan["nicknames"]
    assert all(len(set(name)) == len(name) and valid(name).is_valid for name in plan["nicknames"])
    frequencies = [item["count"] for item in plan["synthetic"]["frequencies"]]
    assert max(frequencies) - min(frequencies) <= 1
    assert plan["synthetic"]["groups"]["hangul"] == 0


def test_real_growth_can_reduce_or_increase_supplement_and_tolerance_is_user_controlled():
    config = options()
    config["targets"]["latin"] = 50
    config["characters"]["latin"] = "ABCDEFGH"
    baseline = [{"text": "가나", "split": "train"} for _ in range(10)]
    need = plan_supplement(baseline, config, valid)["synthetic"]["characters"]
    less = plan_supplement(baseline + [{"text": "ABCDEF", "split": "train"}], config, valid)[
        "synthetic"
    ]["characters"]
    more = plan_supplement(baseline + [{"text": "다라마", "split": "train"}], config, valid)[
        "synthetic"
    ]["characters"]
    assert less < need < more
    config["tolerance"] = 10
    tolerant = plan_supplement(baseline, config, valid)
    assert tolerant["synthetic"]["characters"] < need
    assert abs(tolerant["differences"]["latin"]) <= 10


def test_unreachable_goals_and_finite_name_space_warn_without_blocking():
    config = options(maxImages=3)
    config["targets"]["special"] = 100
    config["characters"]["special"] = "★"
    plan = plan_supplement([{"text": "가나다", "split": "train"}], config, valid)
    assert plan["nicknames"] == ["★"]
    assert plan["warnings"]
    assert plan["real"]["images"] == 1
    with pytest.raises(InterruptedError):
        plan_supplement([{"text": "가", "split": "train"}], config, valid, lambda: True)


def test_invalid_settings_are_distinct_from_unmet_targets():
    config = options()
    config["targets"]["latin"] = 110
    with pytest.raises(ValueError):
        plan_supplement([{"text": "가", "split": "train"}], config, valid)
    config["targets"]["latin"] = 20
    config["characters"]["latin"] = "★"
    with pytest.raises(ValueError, match="문자군"):
        plan_supplement([{"text": "가", "split": "train"}], config, valid)


def test_rgba_is_composited_not_discarded_and_text_cannot_be_cropped(tmp_path):
    config = options()
    image, metadata = composite(
        Image.new("RGBA", (4, 4), (200, 100, 0, 128)), config, [], random.Random(0)
    )
    assert image.mode == "RGB"
    assert image.getpixel((0, 0)) == (20, 40, 60)
    assert image.getpixel((19, 9)) == (110, 70, 30)
    assert metadata["textOffset"] == [18, 8]
    with pytest.raises(ValueError, match="크롭"):
        composite(Image.new("RGBA", (50, 4)), config, [], random.Random(0))
    background = tmp_path / "background.png"
    Image.new("RGBA", (50, 25), (20, 30, 40, 200)).save(background)
    with pytest.raises(ValueError, match="불투명"):
        composite(Image.new("RGBA", (4, 4)), config, [background], random.Random(0))


class FakeRenderer:
    def render(self, text, **_options):
        # This tests alpha composition and input selection, not game font appearance.
        return SimpleNamespace(
            image=Image.new("RGBA", (len(text) * 4, 5), (255, 255, 0, 128)), metadata={"text": text}
        )


@pytest.mark.parametrize("version", ["0.1.1", "0.1.3"])
def test_unsupported_synthesizer_fails_before_constructing_renderer(snapshot, monkeypatch, version):
    root, _ = snapshot
    output = root / "previews/version-check"
    output.mkdir(parents=True)
    renderer = Mock()
    module = SimpleNamespace(FontPaths=Mock(), Renderer=renderer, validate_nickname=valid)
    monkeypatch.setitem(sys.modules, "dnf_ocr_synth", module)
    monkeypatch.setattr("importlib.metadata.version", lambda _: version)

    with pytest.raises(ValueError, match="0.1.2"):
        prepare_supplement(
            {
                "directory": str(root),
                "outputDirectory": str(output),
                "mode": "preview",
                "options": options(),
            }
        )

    renderer.assert_not_called()
    assert not (output / "images").exists()


def test_generate_uses_frozen_real_input_and_one_selected_supplement_only(snapshot):
    root, dataset = snapshot
    before = {name: digest(root / name) for name in ("dataset.json", "model/characters.txt")}
    config = options()
    config["targets"]["latin"] = 75
    config["characters"]["latin"] = "ABCD"
    run = root / "runs/first"
    output = run / "synthetic"
    output.mkdir(parents=True)
    request = {
        "directory": str(root),
        "outputDirectory": str(output),
        "mode": "generate",
        "options": config,
    }
    data = prepare_supplement(request, renderer=FakeRenderer(), validator=valid)
    chars = set("가나다ABCD ")
    rows, _ = load_supplement(root, run, digest(output / "supplement.json"), dataset, chars)
    assert len(rows) == data["plan"]["synthetic"]["images"] > 0
    assert all(row["split"] == "train" for row in rows)
    assert dataset["counts"] == {"train": 1, "val": 1, "test": 1, "skipped": 0}
    assert all(digest(root / name) == sha for name, sha in before.items())
    with Image.open(root / rows[0]["image"]) as image:
        assert image.mode == "RGB"
    data["samples"][0]["text"] = "나"
    (output / "supplement.json").write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(ValueError, match="중복"):
        load_supplement(root, run, digest(output / "supplement.json"), dataset, chars)


def test_expansion_is_explicit_and_preserves_original_dictionary_and_input(snapshot):
    root, _ = snapshot
    original = (root / "model/characters.txt").read_bytes()
    added = write_run_dictionary(
        root / "model/characters.txt", root / "expanded.txt", "★龍あア ★가"
    )
    assert added == ["★", "龍", "あ", "ア"]
    assert (root / "expanded.txt").read_text(encoding="utf-8").splitlines() == [
        "가",
        "나",
        "다",
        *added,
    ]
    assert (root / "model/characters.txt").read_bytes() == original
    assert extend_characters(["가", "나"], "가★") == ["가", "나", "★"]
    load_snapshot(root, "★龍あア")


def test_weight_extension_preserves_all_existing_classes_space_special_tokens_and_non_heads():
    original = ["가", "나"]
    extended = [*original, "★", "龍", "あ", "ア"]
    axes = {
        "head.ctc_head.fc.weight": (1, 1, 0),
        "head.ctc_head.fc.bias": (0, 1, 0),
        "head.gtc_head.embedding.embedding.weight": (0, 4, 1),
        "head.gtc_head.tgt_word_prj.weight": (1, 4, 1),
    }
    state = {"backbone.weight": np.arange(4, dtype=np.float32)}
    initialized = {"backbone.weight": np.full(4, -1, dtype=np.float32)}
    for name, (axis, prefix, trailing) in axes.items():
        source_shape = (
            [3, prefix + len(original) + 1 + trailing]
            if axis == 1
            else [prefix + len(original) + 1 + trailing, 3]
        )
        if name.endswith("bias"):
            source_shape = source_shape[:1]
        target_shape = source_shape.copy()
        target_shape[axis] += len(extended) - len(original)
        state[name] = np.arange(np.prod(source_shape), dtype=np.float32).reshape(source_shape)
        initialized[name] = np.full(target_shape, -1, dtype=np.float32)
    result = expand_state_arrays(state, initialized, original, extended)
    np.testing.assert_array_equal(result["backbone.weight"], state["backbone.weight"])
    for name, (axis, prefix, trailing) in axes.items():
        indices = list(range(prefix + len(original))) + list(
            range(prefix + len(extended), prefix + len(extended) + 1 + trailing)
        )
        np.testing.assert_array_equal(np.take(result[name], indices, axis=axis), state[name])
        np.testing.assert_array_equal(
            np.take(
                result[name], list(range(prefix + len(original), prefix + len(extended))), axis=axis
            ),
            -1,
        )
        assert np.all(initialized[name] == -1)
    with pytest.raises(ValueError, match="순서"):
        expand_state_arrays(state, initialized, original, ["나", "가", "★"])
    broken = {**initialized, "backbone.weight": np.zeros(8, dtype=np.float32)}
    with pytest.raises(ValueError, match="출력층 밖"):
        expand_state_arrays(state, broken, original, extended)
