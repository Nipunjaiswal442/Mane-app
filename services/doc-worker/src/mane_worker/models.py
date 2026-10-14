from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Segment(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    start_s: float = Field(ge=0)
    end_s: float = Field(ge=0)
    speaker: str | None = None
    text: str

    @model_validator(mode="after")
    def ordered(self):
        if self.end_s < self.start_s:
            raise ValueError("segment end_s must be >= start_s")
        return self


class Transcript(BaseModel):
    model_config = ConfigDict(extra="forbid")
    language: str
    segments: list[Segment]


class STT(Protocol):
    def transcribe(self, wav_path: str, language: str | None) -> Transcript: ...
    def close(self) -> None: ...


class LLM(Protocol):
    def complete_json(self, system: str, user: str, schema: dict, max_tokens: int) -> dict: ...
    def close(self) -> None: ...


class Storage(Protocol):
    def download(self, key: str, destination: str) -> None: ...
    def upload(self, key: str, source: str, mime: str) -> dict: ...
