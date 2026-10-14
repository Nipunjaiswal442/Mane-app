import json
import socket

import httpx
import pytest

from mane_worker.adapters.llm import VLLM, OllamaLLM
from mane_worker.adapters.speech import NoDiarization, local_model
from mane_worker.adapters.storage import LocalStorage, safe_key
from mane_worker.config import appliance_url
from mane_worker.pipeline import normalize_audio


def test_loopback_only_by_default(monkeypatch):
    monkeypatch.delenv("APPLIANCE_HOSTS", raising=False)
    for url in ("http://127.0.0.1:8000", "http://localhost:11434", "http://[::1]:5000"):
        assert appliance_url(url) == url
    for url in (
        "https://api.openai.com",
        "https://evil.local",
        "file:///tmp/data",
        "http://u:p@localhost",
    ):
        with pytest.raises(ValueError):
            appliance_url(url)


def test_explicit_appliance_hosts(monkeypatch):
    monkeypatch.setenv("APPLIANCE_HOSTS", "api,ollama,minio")
    assert appliance_url("http://ollama:11434/") == "http://ollama:11434"


def test_network_fixture_rejects_outbound():
    with socket.socket() as client:
        with pytest.raises(AssertionError, match="outbound"):
            client.connect(("8.8.8.8", 80))


def test_local_storage_roundtrip_and_hash(tmp_path):
    store = LocalStorage(tmp_path / "data")
    source, target = tmp_path / "input", tmp_path / "output"
    source.write_bytes(b"private recording")
    result = store.upload("org/meeting/audio.wav", str(source), "audio/wav")
    store.download(result["storageKey"], str(target))
    assert target.read_bytes() == b"private recording"
    assert result["bytes"] == 17
    assert len(result["sha256"]) == 64


@pytest.mark.parametrize(
    "key", ["../secret", "/etc/passwd", "org/../../secret", "org\\secret", "\x00", ""]
)
def test_storage_rejects_traversal(key):
    with pytest.raises(ValueError):
        safe_key(key)


def test_storage_rejects_symlink_escape(tmp_path):
    store = LocalStorage(tmp_path / "data")
    (store.root / "outside").symlink_to(tmp_path)
    with pytest.raises(ValueError):
        store.path("outside/secret")


def test_speech_never_downloads_missing_weights(monkeypatch):
    monkeypatch.setenv("STT_MODEL_PATH", "mlx-community/whisper-large-v3-turbo")
    with pytest.raises(ValueError, match="pre-provisioned"):
        local_model("STT_MODEL_PATH")


def test_speech_local_model_forces_offline_mode(monkeypatch, tmp_path):
    monkeypatch.setenv("STT_MODEL_PATH", str(tmp_path))
    assert local_model("STT_MODEL_PATH") == str(tmp_path.resolve())
    import os

    assert os.environ["HF_HUB_OFFLINE"] == "1"


def test_no_diarization_is_identity(transcript):
    assert NoDiarization().apply("unused.wav", transcript) is transcript


def test_ollama_structured_json_and_unload(minutes, schema):
    requests = []

    def respond(request):
        requests.append(request)
        if request.url.path.endswith("/generate"):
            return httpx.Response(200, json={"done": True})
        return httpx.Response(200, json={"message": {"content": json.dumps(minutes)}})

    llm = OllamaLLM()
    llm.client.close()
    llm.client = httpx.Client(transport=httpx.MockTransport(respond))
    assert llm.complete_json("system", "transcript", schema, 1000) == minutes
    llm.close()
    assert json.loads(requests[0].content)["format"] == schema
    assert json.loads(requests[-1].content)["keep_alive"] == 0


def test_vllm_uses_local_schema_constrained_endpoint(minutes, schema):
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(
            200, json={"choices": [{"message": {"content": json.dumps(minutes)}}]}
        )

    llm = VLLM()
    llm.client.close()
    llm.client = httpx.Client(transport=httpx.MockTransport(respond))
    assert llm.complete_json("system", "transcript", schema, 1000) == minutes
    llm.close()
    assert requests[0].url.host == "127.0.0.1"
    assert json.loads(requests[0].content)["response_format"]["json_schema"]["schema"] == schema


def test_ffmpeg_normalizes_fixture_to_mono_16khz(tmp_path):
    import shutil
    import wave

    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg prerequisite unavailable")
    source, normalized = tmp_path / "input.wav", tmp_path / "output.wav"
    with wave.open(str(source), "wb") as file:
        file.setnchannels(2)
        file.setsampwidth(2)
        file.setframerate(44100)
        file.writeframes(bytes(44100 * 4))
    assert normalize_audio(str(source), str(normalized)) == pytest.approx(1, abs=0.01)
    with wave.open(str(normalized)) as file:
        assert file.getnchannels() == 1
        assert file.getframerate() == 16000


def test_database_rejects_public_hosts_and_hostaddr_override(monkeypatch):
    from mane_worker.config import database_url

    monkeypatch.delenv("APPLIANCE_HOSTS", raising=False)
    assert database_url("postgresql://mane:secret@127.0.0.1:5432/mane")
    assert database_url("host=/private/tmp dbname=mane")
    for dsn in (
        "postgresql://mane:secret@database.example.com/mane",
        "postgresql://mane:secret@localhost/mane?hostaddr=8.8.8.8",
        "service=cloud",
    ):
        with pytest.raises(ValueError):
            database_url(dsn)
