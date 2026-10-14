import copy
import ipaddress
import socket

import pytest

from mane_worker.config import ROOT
from mane_worker.models import Transcript
from mane_worker.pipeline import load_schema


@pytest.fixture(autouse=True)
def forbid_outbound_network(monkeypatch):
    """Fail tests that attempt to send recording data outside the appliance."""
    original = socket.socket.connect

    def connect(sock, address):
        if sock.family == socket.AF_UNIX:
            return original(sock, address)
        host = address[0]
        try:
            allowed = ipaddress.ip_address(host).is_loopback
        except ValueError:
            allowed = host == "localhost"
        if not allowed:
            raise AssertionError(f"Test attempted outbound network connection: {host}")
        return original(sock, address)

    monkeypatch.setattr(socket.socket, "connect", connect)


@pytest.fixture
def schema():
    return load_schema(ROOT / "packages/shared/minutes.schema.json")


@pytest.fixture
def transcript():
    return Transcript(
        language="en",
        segments=[
            {
                "start_s": 0,
                "end_s": 8,
                "speaker": "SPEAKER_00",
                "text": "We decided to launch the pilot on Monday.",
            },
            {
                "start_s": 8,
                "end_s": 16,
                "speaker": "SPEAKER_01",
                "text": "Priya Sharma will prepare the onboarding checklist by Friday.",
            },
            {"start_s": 20, "end_s": 24, "speaker": None, "text": "Thank you, see you next week."},
        ],
    )


@pytest.fixture
def minutes():
    return {
        "title": "Pilot planning",
        "held_at": "2026-09-14T10:00:00Z",
        "attendees": [{"name": "Priya Sharma", "matched_user_id": None}],
        "summary": (
            "The team discussed the pilot launch. They agreed to start on Monday. "
            "Priya will prepare the onboarding checklist."
        ),
        "agenda": ["Pilot launch"],
        "decisions": [
            {"text": "Launch the pilot on Monday.", "evidence": [{"start_s": 0, "end_s": 8}]}
        ],
        "action_items": [
            {
                "text": "Prepare onboarding checklist",
                "owner": "Priya Sharma",
                "due_date": None,
                "evidence": [{"start_s": 8, "end_s": 16}],
            }
        ],
        "open_questions": [],
        "risks": [],
        "next_meeting": None,
        "confidence_notes": [],
    }


class FixtureLLM:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.prompts = []

    def complete_json(self, system, user, schema, max_tokens):
        self.prompts.append(user)
        value = self.responses[min(len(self.prompts) - 1, len(self.responses) - 1)]
        if isinstance(value, Exception):
            raise value
        return copy.deepcopy(value)

    def close(self):
        pass
