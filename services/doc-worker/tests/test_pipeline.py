import copy
import json

import pytest
from conftest import FixtureLLM
from pydantic import ValidationError

from mane_worker.models import Transcript
from mane_worker.pipeline import (
    chunk_transcript,
    complete_validated,
    draft_minutes,
    enforce_evidence,
    match_owner,
    span_exists,
    token_estimate,
    validate_minutes,
)


def test_minutes_match_shared_schema(minutes, schema):
    validate_minutes(minutes, schema)


def test_invalid_json_retries_once(minutes, schema):
    llm = FixtureLLM(json.JSONDecodeError("broken", "", 0), minutes)
    assert complete_validated(llm, "extract", schema) == minutes
    assert len(llm.prompts) == 2
    assert "failed validation" in llm.prompts[1]


def test_schema_invalid_twice_fails(schema):
    llm = FixtureLLM({"wrong": True})
    with pytest.raises(ValueError, match="after one retry"):
        complete_validated(llm, "extract", schema)
    assert len(llm.prompts) == 2


def test_drops_missing_and_out_of_range_evidence(minutes, transcript, schema):
    minutes["decisions"].append({"text": "Unsupported claim", "evidence": []})
    minutes["action_items"].append(
        {
            "text": "Invented action",
            "owner": None,
            "due_date": None,
            "evidence": [{"start_s": 999, "end_s": 1000}],
        }
    )
    result = complete_validated(FixtureLLM(minutes), "extract", schema, transcript)
    assert len(result["decisions"]) == 1
    assert len(result["action_items"]) == 1
    assert len(result["confidence_notes"]) == 2


def test_missing_evidence_property_is_dropped(minutes, transcript, schema):
    del minutes["decisions"][0]["evidence"]
    result = complete_validated(FixtureLLM(minutes), "extract", schema, transcript)
    assert result["decisions"] == []


@pytest.mark.parametrize(
    "start,end,expected",
    [
        (0, 8, True),
        (2, 14, True),
        (9, 12, True),
        (16, 20, False),
        (0, 24, False),
        (0, 0, False),
        (-1, 8, False),
        (0, float("nan"), False),
        (True, 8, False),
        (24, 30, False),
    ],
)
def test_evidence_must_cover_actual_speech(transcript, start, end, expected):
    assert span_exists({"start_s": start, "end_s": end}, transcript) == expected


def test_exact_duplicate_claims_removed(minutes, transcript):
    minutes["decisions"].append(copy.deepcopy(minutes["decisions"][0]))
    assert len(enforce_evidence(minutes, transcript)["decisions"]) == 1


def test_fuzzy_owner_match_requires_unambiguous_name():
    users = [
        {"id": "a", "displayName": "Priya Sharma", "email": "priya@mane.local"},
        {"id": "b", "displayName": "Daniel Kim", "email": "daniel@mane.local"},
    ]
    assert match_owner("Priya Shama", users) == "a"
    assert match_owner("daniel", users) == "b"
    assert match_owner("someone else", users) is None
    assert match_owner("", users) is None
    assert (
        match_owner("priya", users + [{"id": "c", "displayName": "Priya", "email": "priya2@x"}])
        is None
    )


def test_empty_transcript_has_no_actions_or_llm_call(schema):
    llm = FixtureLLM({})
    result = draft_minutes(
        llm,
        Transcript(language="en", segments=[]),
        {"title": "Silent recording", "heldAt": None},
        [],
        schema,
    )
    validate_minutes(result, schema)
    assert result["action_items"] == result["decisions"] == []
    assert llm.prompts == []


def test_conversational_transcript_can_have_zero_actions(minutes, transcript, schema):
    minutes.update(decisions=[], action_items=[])
    result = draft_minutes(
        FixtureLLM(minutes), transcript, {"title": "Chat", "heldAt": None}, [], schema
    )
    assert result["decisions"] == result["action_items"] == []
    assert result["held_at"] is None


def test_map_reduce_has_overlap_and_final_merge(minutes, schema):
    transcript = Transcript(
        language="en",
        segments=[{"start_s": i, "end_s": i + 1, "text": "team work " * 80} for i in range(20)],
    )
    chunks = chunk_transcript(transcript)
    assert len(chunks) > 1
    assert any(chunks[index][-1] == chunks[index + 1][0] for index in range(len(chunks) - 1))
    assert all(sum(token_estimate(s.text) for s in chunk) <= 2500 for chunk in chunks)
    llm = FixtureLLM(minutes)
    draft_minutes(llm, transcript, {"title": "Long meeting", "heldAt": None}, [], schema)
    assert len(llm.prompts) > len(chunks)
    assert "Merge these extracted minutes" in llm.prompts[-1]


def test_single_giant_segment_is_split_without_inventing_timestamps():
    transcript = Transcript(
        language="hi", segments=[{"start_s": 0, "end_s": 500, "text": "शब्द " * 10000}]
    )
    chunks = chunk_transcript(transcript)
    assert len(chunks) > 1
    assert all(token_estimate(s.text) <= 2500 for chunk in chunks for s in chunk)
    assert all(s.start_s == 0 and s.end_s == 500 for chunk in chunks for s in chunk)


def test_reversed_and_nonfinite_transcript_spans_rejected():
    for end in (-1, float("nan"), float("inf")):
        with pytest.raises(ValidationError):
            Transcript(language="en", segments=[{"start_s": 0, "end_s": end, "text": "bad"}])


def test_impossible_calendar_date_retried(minutes, schema):
    invalid = copy.deepcopy(minutes)
    invalid["action_items"][0]["due_date"] = "2026-02-30"
    llm = FixtureLLM(invalid, minutes)
    assert complete_validated(llm, "extract", schema) == minutes
    assert len(llm.prompts) == 2


def test_same_action_for_distinct_owners_is_not_dropped(minutes, transcript):
    distinct = copy.deepcopy(minutes["action_items"][0])
    distinct["owner"] = "Daniel Kim"
    minutes["action_items"].append(distinct)
    assert len(enforce_evidence(minutes, transcript)["action_items"]) == 2


def test_context_budget_prevents_oversized_prompt_call(monkeypatch, schema):
    monkeypatch.setenv("LLM_CONTEXT_TOKENS", "4096")
    llm = FixtureLLM({})
    with pytest.raises(ValueError, match="context budget"):
        complete_validated(llm, "transcript " * 3000, schema)
    assert llm.prompts == []


def test_context_budget_reduces_output_allocation(monkeypatch, minutes, schema):
    monkeypatch.setenv("LLM_CONTEXT_TOKENS", "4096")
    observed = []

    class LimitedLLM(FixtureLLM):
        def complete_json(self, system, user, schema, max_tokens):
            observed.append(max_tokens)
            return super().complete_json(system, user, schema, max_tokens)

    complete_validated(LimitedLLM(minutes), "short transcript", schema)
    assert 512 <= observed[0] < 4500


def test_exact_quotation_repairs_shifted_action_evidence(minutes, schema):
    transcript = Transcript(
        language="en",
        segments=[
            {
                "start_s": 9.8,
                "end_s": 14.9,
                "text": "Priya Sharma will write the onboarding checklist by September 30, 2026.",
            },
            {
                "start_s": 15.48,
                "end_s": 20.78,
                "text": "Daniel Kim will verify backup restoration by October 2, 2026.",
            },
            {"start_s": 20.78, "end_s": 23.78, "text": "No customer information was discussed."},
        ],
    )
    minutes["decisions"] = []
    minutes["action_items"] = [
        {
            "text": transcript.segments[0].text,
            "owner": "Priya Sharma",
            "due_date": "2026-09-30",
            "evidence": [{"start_s": 15.48, "end_s": 20.78}],
        },
        {
            "text": transcript.segments[1].text,
            "owner": "Daniel Kim",
            "due_date": "2026-10-02",
            "evidence": [{"start_s": 20.78, "end_s": 23.78}],
        },
    ]
    result = complete_validated(FixtureLLM(minutes), "extract", schema, transcript)
    assert result["action_items"][0]["evidence"] == [{"start_s": 9.8, "end_s": 14.9}]
    assert result["action_items"][1]["evidence"] == [{"start_s": 15.48, "end_s": 20.78}]
    assert len(result["confidence_notes"]) == 2
    assert all("Realigned evidence" in note for note in result["confidence_notes"])


def test_exact_quote_match_does_not_infer_paraphrases_or_remove_negation():
    from mane_worker.pipeline import exact_quote_span

    transcript = Transcript(
        language="en",
        segments=[
            {"start_s": 0, "end_s": 8, "text": "We did not agree to launch the pilot on Monday."},
        ],
    )
    assert exact_quote_span("We agreed to launch the pilot on Monday.", transcript) is None
    assert exact_quote_span("launch the pilot on Monday", transcript) is None
    assert exact_quote_span(transcript.segments[0].text, transcript) == {
        "start_s": 0,
        "end_s": 8,
    }


def test_exact_quote_match_rejects_repeated_ambiguous_statements():
    from mane_worker.pipeline import exact_quote_span

    transcript = Transcript(
        language="en",
        segments=[
            {"start_s": 0, "end_s": 8, "text": "Priya will prepare the checklist."},
            {"start_s": 20, "end_s": 28, "text": "Priya will prepare the checklist."},
        ],
    )
    assert exact_quote_span("Priya will prepare the checklist.", transcript) is None
