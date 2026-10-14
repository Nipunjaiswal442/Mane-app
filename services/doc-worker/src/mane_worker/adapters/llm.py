import json
import os

import httpx

from mane_worker.config import appliance_url, llm_context_tokens


class OllamaLLM:
    def __init__(self):
        self.base_url = appliance_url(os.getenv("OLLAMA_URL", "http://127.0.0.1:11434"))
        self.model = os.getenv("LLM_MODEL", "qwen2.5:3b-instruct")
        self.client = httpx.Client(timeout=900, follow_redirects=False, trust_env=False)
        self.used = False

    def complete_json(self, system: str, user: str, schema: dict, max_tokens: int) -> dict:
        self.used = True
        response = self.client.post(
            f"{self.base_url}/api/chat",
            json={
                "model": self.model,
                "stream": False,
                "format": schema,
                "keep_alive": "5m",
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "options": {
                    "temperature": 0,
                    "num_predict": max_tokens,
                    "num_ctx": llm_context_tokens(),
                },
            },
        )
        response.raise_for_status()
        return json.loads(response.json()["message"]["content"])

    def close(self) -> None:
        try:
            if self.used:
                response = self.client.post(
                    f"{self.base_url}/api/generate",
                    json={"model": self.model, "keep_alive": 0, "stream": False},
                    timeout=15,
                )
                response.raise_for_status()
        finally:
            self.client.close()


class VLLM:
    def __init__(self):
        self.base_url = appliance_url(os.getenv("VLLM_URL", "http://127.0.0.1:8000/v1"))
        self.model = os.getenv("LLM_MODEL", "Qwen/Qwen2.5-7B-Instruct")
        self.client = httpx.Client(timeout=900, follow_redirects=False, trust_env=False)

    def complete_json(self, system: str, user: str, schema: dict, max_tokens: int) -> dict:
        response = self.client.post(
            f"{self.base_url}/chat/completions",
            json={
                "model": self.model,
                "temperature": 0,
                "max_tokens": max_tokens,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {"name": "minutes", "strict": True, "schema": schema},
                },
            },
        )
        response.raise_for_status()
        return json.loads(response.json()["choices"][0]["message"]["content"])

    def close(self) -> None:
        # vLLM owns the persistent production model; close our client only.
        self.client.close()


def create_llm():
    backend = os.getenv("LLM_BACKEND", "ollama")
    if backend == "ollama":
        return OllamaLLM()
    if backend == "vllm":
        return VLLM()
    raise ValueError(f"Unknown LLM_BACKEND {backend!r}")
