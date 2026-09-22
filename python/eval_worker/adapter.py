"""Reuse the training project's model, pixels, CTC decoding, and metric contracts."""

import hashlib
import importlib
import os
import platform
import subprocess
import sys
from pathlib import Path

from .dataset import read_object

REQUIRED_MODULES = (
    "training/runtime.py",
    "training/checkpoint.py",
    "training/pooling.py",
    "training/preprocessing.py",
    "training/evaluation.py",
    "recognition/ctc.py",
    "recognition/metrics.py",
    "recognition/distance.py",
)


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def source_directory(path: Path) -> Path:
    """The setting is a repository/snapshot root, never a guessed installed package."""
    source = path.resolve(strict=True) / "python" / "src"
    if not all((source / "ldb_ocr" / name).is_file() for name in REQUIRED_MODULES):
        raise ValueError("ldbOcrSourcePath needs the full training source with checkpoint.py.")
    return source


def validate_run(run: Path, checkpoint: Path) -> tuple[dict, dict]:
    run = run.resolve(strict=True)
    checkpoint = checkpoint.resolve(strict=True)
    if checkpoint != (run / "checkpoints" / "latest.pdparams").resolve(strict=True):
        raise ValueError("The existing ldb-ocr loader supports only checkpoints/latest.pdparams.")
    request = read_object(run / "request.json")
    required = {
        "run",
        "dictionary",
        "dictionarySha256",
        "manifestSha256",
        "upstream",
        "revision",
        "useSpace",
        "model",
        "profile",
        "imageStage",
    }
    if not required.issubset(request):
        raise ValueError("The run request.json is missing required training provenance.")
    if Path(request["run"]).resolve(strict=True) != run:
        raise ValueError("Selected run differs from request.json; relocated runs are unsupported.")
    if Path(request["dictionary"]).resolve(strict=True) != (run / "characters.txt").resolve(
        strict=True
    ):
        raise ValueError("The run dictionary must be its recorded characters.txt.")
    if type(request["useSpace"]) is not bool or request["imageStage"] != "raw-nickname-crop":
        raise ValueError("Unsupported training input/dictionary contract.")
    if not (Path(request["upstream"]) / "ppocr").is_dir():
        raise ValueError("The recorded PaddleOCR upstream source is unavailable.")
    training = read_object(run / "training.json")
    files = training.get("checkpointFiles")
    if not isinstance(files, dict) or "latest.pdparams" not in files:
        raise ValueError("The training report has no recorded latest checkpoint digest.")
    for name, expected in files.items():
        if (
            not isinstance(name, str)
            or Path(name).name != name
            or "/" in name
            or "\\" in name
            or not isinstance(expected, str)
            or len(expected) != 64
        ):
            raise ValueError("Invalid checkpoint integrity record.")
    return request, training


class LdbOcrAdapter:
    def __init__(self, settings: dict) -> None:
        source = source_directory(Path(settings["ldbOcrSourcePath"]))
        run = Path(settings["runDirectory"]).resolve(strict=True)
        checkpoint = Path(settings["checkpointPath"]).resolve(strict=True)
        request, training = validate_run(run, checkpoint)
        sys.path.insert(0, str(source))
        os.environ["NVIDIA_TF32_OVERRIDE"] = "0"
        os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
        sys.dont_write_bytecode = True
        runtime = importlib.import_module("ldb_ocr.training.runtime")
        if not Path(runtime.__file__).resolve().is_relative_to(source):
            raise ValueError(
                "An already imported ldb_ocr package differs from the selected source."
            )
        runtime.configure_cuda_libraries()
        import numpy as np
        import paddle
        import yaml

        if not paddle.is_compiled_with_cuda() or paddle.device.cuda.device_count() < 1:
            raise RuntimeError("A working Paddle CUDA GPU is required; CPU fallback is disabled.")
        paddle.set_device("gpu:0")
        with (run / "config.yml").open(encoding="utf-8") as stream:
            config = yaml.safe_load(stream)
        if not isinstance(config, dict) or not isinstance(config.get("Global"), dict):
            raise ValueError("The run config.yml has no Global model contract.")
        global_config = config["Global"]
        if (
            Path(global_config["character_dict_path"]).resolve(strict=True)
            != Path(request["dictionary"]).resolve(strict=True)
            or global_config.get("use_space_char") is not request["useSpace"]
            or config.get("PostProcess", {}).get("name") != "CTCLabelDecode"
        ):
            raise ValueError("config.yml and request.json disagree on the CTC dictionary.")
        result = subprocess.run(
            ["git", "-C", request["upstream"], "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
        if result.stdout.strip() != request["revision"]:
            raise ValueError(
                "PaddleOCR upstream revision differs from the recorded training revision."
            )

        loader = importlib.import_module("ldb_ocr.training.checkpoint")
        preprocessing = importlib.import_module("ldb_ocr.training.preprocessing")
        evaluation = importlib.import_module("ldb_ocr.training.evaluation")
        metrics = importlib.import_module("ldb_ocr.recognition.metrics")
        distance = importlib.import_module("ldb_ocr.recognition.distance")
        self.model, _ = loader.load_trained_checkpoint(request)
        self.classes = evaluation.character_classes(
            Path(request["dictionary"]), request["useSpace"]
        )
        self.tensor_from_png = preprocessing.tensor_from_png
        self.decode_output = evaluation.decode_output
        self.recognition_metrics = metrics.recognition_metrics
        self.edit_distance = distance.edit_distance
        self.np = np
        self.paddle = paddle
        self.reproducibility = {
            "python": platform.python_version(),
            "paddle": paddle.__version__,
            "numpy": np.__version__,
            "device": "gpu:0",
            "gpu": paddle.device.cuda.get_device_name(0),
            "cuda": paddle.version.cuda(),
            "precision": "float32; NVIDIA_TF32_OVERRIDE=0",
            "sourcePath": str(source.parent.parent),
            "sourceSha256": {name: sha256(source / "ldb_ocr" / name) for name in REQUIRED_MODULES},
            "upstreamRevision": request["revision"],
            "checkpointSha256": sha256(checkpoint),
            "dictionarySha256": sha256(Path(request["dictionary"])),
            "configSha256": sha256(run / "config.yml"),
            "requestSha256": sha256(run / "request.json"),
            "trainingReportSha256": sha256(run / "training.json"),
            "preprocessing": preprocessing.PREPROCESSING,
            "poolingPolicy": training.get("poolingPolicy", "upstream-default"),
            "normalization": "none",
            "confidence": "unavailable: existing decoder returns text only; no filtering",
            "batchSize": 1,
        }

    def validate_image(self, raw: bytes) -> None:
        self.tensor_from_png(raw)

    def model_input(self, raw: bytes) -> object:
        tensor, _ = self.tensor_from_png(raw)
        return self.paddle.to_tensor(self.np.stack([tensor]))

    def predict(self, raw: bytes) -> tuple[str, None]:
        with self.paddle.no_grad():
            output = self.model(self.model_input(raw)).numpy()
        return self.decode_output(output, self.classes), None

    def summarize(self, pairs: list[tuple[str, str]]) -> dict:
        metrics = self.recognition_metrics(pairs)
        return {
            "cer": metrics["cer"],
            "exactMatch": metrics["exact_match"],
            "sampleCount": metrics["samples"],
            "characterCount": sum(len(truth) for truth, _ in pairs),
            "exactMatchCount": sum(truth == prediction for truth, prediction in pairs),
            "editDistance": sum(
                self.edit_distance(truth, prediction) for truth, prediction in pairs
            ),
        }
