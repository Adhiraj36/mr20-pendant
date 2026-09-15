"""Validation for the five files the extraction agent writes.

Each function takes the raw bytes read from disk and returns the parsed,
type-checked value, or raises ValidationError. Nothing here touches AWS or
the filesystem. internal/apply on the Go side re-implements the same rules
independently — the two checks are not shared code, since they run in
different languages, but they must agree on the same five contracts.

TODO(structured_output probe): Task 7's brief (Step 7) asked for a live
`query()` call against claude-agent-sdk>=0.2.152 with a real OAuth token, to
check whether ResultMessage.structured_output exists on this SDK version,
what shape it holds, and whether it could replace the file-write convention
below in a future revision. This session is synthetic-fixtures-only with no
live credentials and is not allowed to make external API calls, so that
probe was not run — do not treat its absence as an answer either way; a
"no" here would be as fabricated as a "yes". Whoever has a real OAuth token
and can run the SDK against the live API should run the snippet in the task
brief and record the actual finding here. Until then, the file convention
below ships regardless of the outcome: files are what let the agent re-read
and correct its own output before finishing (spec §1), which is the
documented reason for choosing them, not a stand-in for a missing SDK
feature.
"""
import json


class ValidationError(Exception):
    """A file does not match its contract. Never partially applied — see
    validate_and_upload, which uploads only once every file has passed."""


VALID_TASK_KINDS = {"message", "spend", "file", "reminder", "other"}
VALID_FACT_KINDS = {"fact", "preference", "person", "decision"}


def _load_array(raw: bytes) -> list:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValidationError(f"not valid JSON: {exc}") from exc
    if not isinstance(data, list):
        raise ValidationError("expected a JSON array at the top level")
    return data


def validate_corrections(raw: bytes, utterance_count: int) -> list:
    """The same shape enrich.ApplyCorrections has always accepted
    (backend/go/internal/enrich/merge.go:68): {"i": <utterance index>,
    "text": "<corrected text>"}."""
    data = _load_array(raw)
    out = []
    for entry in data:
        if not isinstance(entry, dict):
            raise ValidationError("every entry must be an object")
        if "i" not in entry or "text" not in entry:
            raise ValidationError("entry missing i or text")
        i, text = entry["i"], entry["text"]
        if not isinstance(i, int) or isinstance(i, bool):
            raise ValidationError("i must be an integer")
        if not isinstance(text, str) or not text.strip():
            raise ValidationError("text must be a non-empty string")
        if i < 0 or i >= utterance_count:
            raise ValidationError(f"i={i} is out of range for {utterance_count} utterances")
        out.append({"i": i, "text": text.strip()})
    return out


# The same caps internal/apply's ValidateSpeakers enforces on the Go side.
# The label cap is the API's own speaker-rename cap (80), since the app shows
# the two in the same place.
MAX_SPEAKER_LABEL_CHARS = 80
MAX_SPEAKER_DESCRIPTION_CHARS = 200


def validate_speakers(raw: bytes, speaker_indices: set) -> list:
    """speakers.json: a JSON array of {"speaker": <index>, "label": str,
    "description": str}, one entry per diarizer index. An index the
    transcript never used, a duplicate index, a blank label or a non-string
    description fails the whole file. A speaker the agent left out is not an
    error — the app falls back to "Speaker N" for it, as it does for any
    unnamed index today."""
    data = _load_array(raw)
    out = []
    seen = set()
    for entry in data:
        if not isinstance(entry, dict):
            raise ValidationError("every entry must be an object")
        if "speaker" not in entry:
            raise ValidationError("entry missing speaker")
        index = entry["speaker"]
        if not isinstance(index, int) or isinstance(index, bool):
            raise ValidationError("speaker must be an integer")
        if index < 0 or index not in speaker_indices:
            raise ValidationError(f"speaker={index} is not a speaker in this transcript")
        if index in seen:
            raise ValidationError(f"speaker={index} is listed twice")
        seen.add(index)
        label = entry.get("label")
        if not isinstance(label, str) or not label.strip():
            raise ValidationError("label must be a non-empty string")
        description = entry.get("description", "")
        if not isinstance(description, str):
            raise ValidationError("description must be a string")
        out.append({
            "speaker": index,
            "label": label.strip()[:MAX_SPEAKER_LABEL_CHARS],
            "description": description.strip()[:MAX_SPEAKER_DESCRIPTION_CHARS],
        })
    return out


def validate_tasks(raw: bytes) -> list:
    data = _load_array(raw)
    out = []
    for entry in data:
        if not isinstance(entry, dict):
            raise ValidationError("every entry must be an object")
        text = entry.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ValidationError("text must be a non-empty string")
        owner = entry.get("owner")
        if owner is not None and (not isinstance(owner, int) or isinstance(owner, bool)):
            raise ValidationError("owner must be an integer or null")
        kind = entry.get("kind", "other")
        if kind not in VALID_TASK_KINDS:
            raise ValidationError(f"kind {kind!r} is not one of {sorted(VALID_TASK_KINDS)}")
        out.append({"text": text.strip()[:400], "owner": owner, "kind": kind})
    return out


def validate_memories(raw: bytes) -> list:
    data = _load_array(raw)
    out = []
    for entry in data:
        if not isinstance(entry, dict):
            raise ValidationError("every entry must be an object")
        text = entry.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ValidationError("text must be a non-empty string")
        kind = entry.get("kind", "fact")
        if kind not in VALID_FACT_KINDS:
            raise ValidationError(f"kind {kind!r} is not one of {sorted(VALID_FACT_KINDS)}")
        out.append({"text": text.strip()[:200], "kind": kind})
    return out


def validate_summary(raw: bytes) -> dict:
    """summary.json: a single object, not an array — {"title": str, "tags":
    [str, ...], "summary": str, "category": str|None}. Field names, types
    and caps mirror enrich.go's Coerce exactly (enrich.go:229-261), so
    ApplyFn writes into the same Recording fields the app already reads.

    category is checked only for type here, not for membership in whatever
    list the agent was given (prompt.build_prompt, Task 6) — resolving a
    name to an id, and answering "" for anything unrecognised, is
    enrich.ResolveCategory's job on the Go side (Task 9), already the one
    place that decision is made. Duplicating a membership check here would
    just be a second, competing answer to the same question.
    """
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValidationError(f"not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValidationError("expected a JSON object, not an array")

    title = data.get("title")
    if not isinstance(title, str) or not title.strip():
        raise ValidationError("title must be a non-empty string")

    tags_raw = data.get("tags", [])
    if not isinstance(tags_raw, list):
        raise ValidationError("tags must be an array")
    tags = []
    for tag in tags_raw[:5]:
        if not isinstance(tag, str):
            raise ValidationError("every tag must be a string")
        cleaned = tag.strip().lower()[:40]
        if cleaned:
            tags.append(cleaned)

    summary = data.get("summary", "")
    if not isinstance(summary, str):
        raise ValidationError("summary must be a string")

    category = data.get("category")
    if category is not None and not isinstance(category, str):
        raise ValidationError("category must be a string or null")

    return {
        "title": title.strip()[:200],
        "tags": tags,
        "summary": summary.strip()[:4000],
        "category": category.strip() if isinstance(category, str) else None,
    }
