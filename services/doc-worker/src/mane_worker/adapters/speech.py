import gc
import importlib
import os
from pathlib import Path

from mane_worker.models import Segment, Transcript


def local_model(variable: str, default: str | None = None) -> str:
    # Loading an identifier from Hugging Face would download at runtime. Require disk.
    value = os.getenv(variable, default or "")
    path = Path(value).expanduser()
    if not value or not path.exists():
        raise ValueError(f"{variable} must point to pre-provisioned local model weights")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    return str(path.resolve())


class MLXSpeech:
    def transcribe(self, wav_path: str, language: str | None) -> Transcript:
        model_path = local_model("STT_MODEL_PATH")
        import mlx_whisper

        result = mlx_whisper.transcribe(
            wav_path, path_or_hf_repo=model_path, language=language, verbose=False
        )
        return Transcript(
            language=result.get("language", language or "und"),
            segments=[
                Segment(start_s=s["start"], end_s=s["end"], text=s["text"].strip())
                for s in result.get("segments", [])
            ],
        )

    def close(self) -> None:
        # mlx-whisper caches its most recent model in ModelHolder; release at job end.
        try:
            module = importlib.import_module("mlx_whisper.transcribe")
            holder = getattr(module, "ModelHolder", None)
            if holder is not None:
                holder.model = None
                holder.model_path = None
            import mlx.core as mx

            gc.collect()
            mx.clear_cache()
        except ImportError:
            pass


class FasterWhisperSpeech:
    def __init__(self):
        self.model = None

    def transcribe(self, wav_path: str, language: str | None) -> Transcript:
        model_path = local_model("STT_MODEL_PATH")
        from faster_whisper import WhisperModel

        self.model = WhisperModel(
            model_path, device="cuda", compute_type="float16", local_files_only=True
        )
        segments, info = self.model.transcribe(
            wav_path, language=language, beam_size=5, vad_filter=True
        )
        return Transcript(
            language=info.language,
            segments=[Segment(start_s=s.start, end_s=s.end, text=s.text.strip()) for s in segments],
        )

    def close(self) -> None:
        self.model = None
        gc.collect()


class NoDiarization:
    def apply(self, path: str, transcript: Transcript) -> Transcript:
        return transcript

    def close(self) -> None:
        pass


class PyannoteDiarization:
    def __init__(self):
        self.pipeline = None

    def apply(self, path: str, transcript: Transcript) -> Transcript:
        config = local_model("DIARIZATION_MODEL_PATH")
        import torch
        from pyannote.audio import Pipeline

        self.pipeline = Pipeline.from_pretrained(config)
        self.pipeline.to(torch.device("cuda"))
        turns = list(self.pipeline(path).itertracks(yield_label=True))
        segments = []
        for segment in transcript.segments:
            best, speaker = 0.0, None
            for turn, _, label in turns:
                overlap = max(0, min(segment.end_s, turn.end) - max(segment.start_s, turn.start))
                if overlap > best:
                    best, speaker = overlap, str(label)
            segments.append(segment.model_copy(update={"speaker": speaker}))
        return transcript.model_copy(update={"segments": segments})

    def close(self) -> None:
        self.pipeline = None
        gc.collect()
        try:
            import torch

            torch.cuda.empty_cache()
        except ImportError:
            pass


def create_stt():
    backend = os.getenv("STT_BACKEND", "mlx")
    if backend == "mlx":
        return MLXSpeech()
    if backend == "faster_whisper":
        return FasterWhisperSpeech()
    raise ValueError(f"Unknown STT_BACKEND {backend!r}")


def create_diarization():
    backend = os.getenv("DIARIZE", "off")
    if backend == "off":
        return NoDiarization()
    if backend == "pyannote":
        return PyannoteDiarization()
    raise ValueError(f"Unknown DIARIZE {backend!r}")
