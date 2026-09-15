import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from schemas import (
    ValidationError, validate_corrections, validate_memories, validate_speakers, validate_summary,
    validate_tasks,
)


def test_valid_corrections_round_trip():
    raw = b'[{"i": 0, "text": "fixed"}]'
    assert validate_corrections(raw, utterance_count=2) == [{"i": 0, "text": "fixed"}]


def test_corrections_rejects_an_out_of_range_index():
    with pytest.raises(ValidationError):
        validate_corrections(b'[{"i": 5, "text": "x"}]', utterance_count=2)


def test_corrections_rejects_a_negative_index():
    with pytest.raises(ValidationError):
        validate_corrections(b'[{"i": -1, "text": "x"}]', utterance_count=2)


def test_corrections_rejects_malformed_json():
    with pytest.raises(ValidationError):
        validate_corrections(b"not json", utterance_count=2)


def test_empty_arrays_are_valid_for_every_file():
    assert validate_corrections(b"[]", utterance_count=2) == []
    assert validate_tasks(b"[]") == []
    assert validate_memories(b"[]") == []
    assert validate_speakers(b"[]", speaker_indices={0, 1}) == []


def test_valid_speakers_round_trip_keyed_by_index():
    raw = b'[{"speaker": 1, "label": " Auto driver ", "description": " Took the wearer to Koramangala. "}]'
    assert validate_speakers(raw, speaker_indices={0, 1}) == [
        {"speaker": 1, "label": "Auto driver", "description": "Took the wearer to Koramangala."},
    ]


def test_speakers_description_is_optional_and_a_voice_may_be_omitted():
    # Leaving speaker 0 out is not an error — the app falls back to "Speaker N".
    assert validate_speakers(b'[{"speaker": 1, "label": "Doctor"}]', speaker_indices={0, 1}) == [
        {"speaker": 1, "label": "Doctor", "description": ""},
    ]


def test_speakers_rejects_an_index_the_transcript_never_had():
    with pytest.raises(ValidationError, match="speaker=3"):
        validate_speakers(b'[{"speaker": 3, "label": "Doctor"}]', speaker_indices={0, 1})
    with pytest.raises(ValidationError):
        validate_speakers(b'[{"speaker": -1, "label": "Doctor"}]', speaker_indices={0, 1})


def test_speakers_rejects_a_duplicate_index():
    raw = b'[{"speaker": 0, "label": "Doctor"}, {"speaker": 0, "label": "Nurse"}]'
    with pytest.raises(ValidationError, match="listed twice"):
        validate_speakers(raw, speaker_indices={0})


def test_speakers_rejects_a_blank_label_a_float_index_and_a_non_string_description():
    with pytest.raises(ValidationError):
        validate_speakers(b'[{"speaker": 0, "label": "  "}]', speaker_indices={0})
    with pytest.raises(ValidationError):
        validate_speakers(b'[{"speaker": 0.0, "label": "Doctor"}]', speaker_indices={0})
    with pytest.raises(ValidationError):
        validate_speakers(b'[{"speaker": 0, "label": "Doctor", "description": 3}]', speaker_indices={0})


def test_speakers_caps_label_and_description():
    raw = json.dumps([{"speaker": 0, "label": "x" * 500, "description": "y" * 500}]).encode()
    [entry] = validate_speakers(raw, speaker_indices={0})
    assert len(entry["label"]) == 80
    assert len(entry["description"]) == 200


def test_tasks_rejects_an_invented_kind():
    with pytest.raises(ValidationError):
        validate_tasks(b'[{"text": "call the vet", "kind": "urgent"}]')


def test_a_partially_written_memories_file_fails_wholesale():
    # One good entry, one with an invented kind — the whole file is untrusted.
    raw = b'[{"text": "a real fact", "kind": "fact"}, {"text": "bad", "kind": "opinion"}]'
    with pytest.raises(ValidationError):
        validate_memories(raw)


def test_memories_rejects_an_entry_with_no_text():
    with pytest.raises(ValidationError):
        validate_memories(b'[{"kind": "fact"}]')


def test_valid_summary_round_trips():
    raw = (
        b'{"title": "Standup with Ravi", "tags": ["work", "standup"], '
        b'"summary": "Discussed the release.", "category": "Work"}'
    )
    out = validate_summary(raw)
    assert out == {
        "title": "Standup with Ravi", "tags": ["work", "standup"],
        "summary": "Discussed the release.", "category": "Work",
    }


def test_summary_requires_a_non_empty_title():
    # A blank title was exactly the regression this file exists to fix.
    with pytest.raises(ValidationError):
        validate_summary(b'{"tags": [], "summary": "x"}')


def test_summary_allows_a_null_category():
    # enrich.go's own ResolveCategory treats "none of them honestly fits" as
    # a legitimate answer, not a failure — summary.json must be allowed the
    # same answer.
    out = validate_summary(b'{"title": "Something happened", "category": null}')
    assert out["category"] is None


def test_summary_is_an_object_not_an_array():
    with pytest.raises(ValidationError):
        validate_summary(b'[{"title": "x"}]')


def test_summary_tags_are_capped_at_five_and_lowercased():
    raw = json.dumps({"title": "x", "tags": ["A", "B", "C", "D", "E", "F"]}).encode()
    out = validate_summary(raw)
    assert out["tags"] == ["a", "b", "c", "d", "e"]


def test_summary_does_not_reject_a_category_it_has_never_seen():
    # Membership in the list the agent was offered is enrich.ResolveCategory's
    # job on the Go side (Task 9) — this validator only checks the type.
    out = validate_summary(b'{"title": "x", "category": "Something Invented"}')
    assert out["category"] == "Something Invented"
