"""Observe supported backbone hooks with train/eval state isolated in memory."""

import hashlib
from pathlib import Path

POINTS = (
    ("input", "모델 입력"),
    ("before-pooling", "Pooling 직전 · blocks6 출력"),
    ("after-pooling", "Pooling 이후 · Backbone 출력"),
)
SUPPORTED_BACKBONE_SHA256 = "dff3212186969ac7feb91df1a2c8f8a4190e89c6a1e90c3e4e47a6bc35ae364e"
SUPPORTED_POOLING_SHA256 = "26bdd658d2e849dba7000f639693ba3f57cc0da26f906569c312f0caebf0546b"


def state_fingerprint(state: dict) -> str:
    digest = hashlib.sha256()
    for name, tensor in sorted(state.items()):
        array = tensor.numpy()
        digest.update(name.encode("utf-8") + b"\0")
        digest.update(str((array.dtype.str, array.shape)).encode("ascii") + b"\0")
        digest.update(array.tobytes(order="C"))
    return digest.hexdigest()


def supported_backbone(backbone) -> None:
    import inspect

    kind = type(backbone)
    if (
        kind.__name__ != "PPLCNetV3"
        or kind.__module__ != "ppocr.modeling.backbones.rec_lcnetv3"
        or getattr(backbone, "det", True)
        or not hasattr(backbone, "blocks6")
    ):
        raise ValueError("This backbone has no verified before/after-pooling observation points.")
    filename = inspect.getsourcefile(kind)
    if (
        filename is None
        or hashlib.sha256(Path(filename).read_bytes()).hexdigest() != SUPPORTED_BACKBONE_SHA256
    ):
        raise ValueError(
            "The backbone source differs from the verified pooling observation contract."
        )

    forward_file = inspect.getsourcefile(backbone.forward)
    if forward_file is None or hashlib.sha256(Path(forward_file).read_bytes()).hexdigest() not in {
        SUPPORTED_BACKBONE_SHA256,
        SUPPORTED_POOLING_SHA256,
    }:
        raise ValueError(
            "The active backbone forward has no verified pooling observation contract."
        )


def collect_shapes(adapter, model_input, validate_backbone=supported_backbone) -> list[dict]:
    rows = [
        {"point": point, "label": label, "train": None, "evaluation": None}
        for point, label in POINTS
    ]
    try:
        if getattr(adapter.model, "use_transform", None) is not False:
            raise ValueError(
                "A pre-backbone Transform prevents direct model-input shape observation."
            )
        backbone = adapter.model.backbone
        validate_backbone(backbone)
        with adapter.paddle.no_grad():
            initial = {
                name: value.detach().clone() for name, value in backbone.state_dict().items()
            }
        initial_hash = state_fingerprint(initial)
        original_modes = [(layer, layer.training) for layer in [backbone, *backbone.sublayers()]]
    except Exception as error:
        for row in rows:
            row["train"] = row["evaluation"] = {"shape": None, "error": str(error)}
        return rows

    for mode in ("train", "evaluation"):
        observed = {}
        handles = []
        error = None

        def capture(point: str, tensor) -> None:
            shape = list(tensor.shape)
            if (
                point in observed
                or len(shape) != 4
                or any(type(value) is not int or value <= 0 for value in shape)
            ):
                raise ValueError(f"Unsupported or repeated actual shape at {point}.")
            observed[point] = shape

        def before(layer, inputs) -> None:
            capture("input", inputs[0])

        def before_pooling(layer, inputs, output) -> None:
            capture("before-pooling", output)

        def after_pooling(layer, inputs, output) -> None:
            capture("after-pooling", output)

        try:
            with adapter.paddle.no_grad():
                backbone.set_state_dict(initial)
                if state_fingerprint(backbone.state_dict()) != initial_hash:
                    raise ValueError("Could not restore identical initial backbone state.")
                backbone.train() if mode == "train" else backbone.eval()
                handles.append(backbone.register_forward_pre_hook(before))
                handles.append(backbone.blocks6.register_forward_post_hook(before_pooling))
                handles.append(backbone.register_forward_post_hook(after_pooling))
                backbone(model_input.detach().clone())
                if set(observed) != {point for point, _ in POINTS}:
                    raise ValueError("Not all actual pooling hooks were observed.")
        except Exception as failure:
            error = f"{type(failure).__name__}: {failure}"
        finally:
            for handle in handles:
                try:
                    handle.remove()
                except Exception as failure:
                    error = f"Hook cleanup failed: {failure}"
            try:
                with adapter.paddle.no_grad():
                    backbone.set_state_dict(initial)
                backbone.eval()
                for layer, training in original_modes:
                    layer.training = training
                if state_fingerprint(backbone.state_dict()) != initial_hash:
                    raise ValueError("Backbone state was not fully restored.")
            except Exception as failure:
                error = f"State restoration failed: {failure}"
        for row in rows:
            row[mode] = {
                "shape": observed.get(row["point"]) if error is None else None,
                "error": error,
            }
    return rows
