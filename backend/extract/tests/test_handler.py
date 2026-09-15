import asyncio
import json
import logging
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import handler
from handler import already_extracted, extraction_prefix, log_result, scrub_environment, speaker_indices


class FakeResultMessage:
    def __init__(self, is_error=False):
        self.total_cost_usd = 0.0123
        self.usage = {"input_tokens": 1000, "output_tokens": 200}
        self.model_usage = {"claude-sonnet-4-5": {"input_tokens": 1000}}
        self.is_error = is_error
        self.session_id = "sess_1"


class ResultMessageMissingEveryField:
    """Stands in for a future claude-agent-sdk release whose ResultMessage
    dropped every attribute log_result reads (requirements.txt pins
    claude-agent-sdk with no upper bound). The worst case the getattr guard
    in log_result must survive without raising."""


class FakeLambdaContext:
    def get_remaining_time_in_millis(self):
        return 60_000


def test_a_clean_result_logs_at_info(caplog):
    with caplog.at_level(logging.INFO):
        log_result(FakeResultMessage(), "rec_1")
    records = [r for r in caplog.records if r.levelno == logging.INFO]
    assert any("rec_1" in r.message for r in records)
    # The whole point of this task: cost and usage must actually appear in
    # the logged line, not just recording_id and the log level.
    assert any("cost_usd=0.0123" in r.message for r in records)
    assert any("usage={'input_tokens': 1000, 'output_tokens': 200}" in r.message for r in records)
    assert any(
        "model_usage={'claude-sonnet-4-5': {'input_tokens': 1000}}" in r.message for r in records
    )


def test_an_error_result_logs_at_error(caplog):
    with caplog.at_level(logging.INFO):
        log_result(FakeResultMessage(is_error=True), "rec_1")
    records = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert records
    assert any("cost_usd=0.0123" in r.message for r in records)
    assert any("usage={'input_tokens': 1000, 'output_tokens': 200}" in r.message for r in records)
    assert any(
        "model_usage={'claude-sonnet-4-5': {'input_tokens': 1000}}" in r.message for r in records
    )


def test_log_result_degrades_to_a_partial_line_instead_of_raising(caplog):
    """claude-agent-sdk is pinned with no upper bound (requirements.txt), so
    a future SDK's ResultMessage can drop or rename a field. log_result is
    called inside turn()'s async for loop with no try/except around it, so
    an AttributeError here would propagate out of turn() -> run_one() ->
    handler()'s bare except Exception and fail (and re-bill) the whole
    extraction just to retry a log line. It must log a partial line instead."""
    with caplog.at_level(logging.INFO):
        log_result(ResultMessageMissingEveryField(), "rec_2")  # must not raise
    assert any(r.levelno == logging.INFO and "rec_2" in r.message for r in caplog.records)


def test_scrub_environment_runs_before_any_record_is_processed(monkeypatch):
    """Mutation-tests the wiring in handler(), not scrub_environment() in
    isolation: moving the scrub_environment() call to the end of handler()
    (or deleting it) leaves every other test in this file green, because
    they only ever call scrub_environment() directly. A stray
    ANTHROPIC_API_KEY reaching the CLI silently bills a Console account
    instead of using the subscription token, with no error anywhere — so
    this asserts the key is already gone from the environment by the time
    handler() starts doing per-record work."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-leaked")
    key_present_when_work_started = []

    def fake_asyncio_run(coro):
        key_present_when_work_started.append("ANTHROPIC_API_KEY" in os.environ)
        coro.close()  # the coroutine is never actually awaited
        return None

    monkeypatch.setattr(asyncio, "run", fake_asyncio_run)

    event = {"Records": [{"messageId": "m1", "body": json.dumps({"recordingId": "rec_1"})}]}
    handler.handler(event, FakeLambdaContext())

    assert key_present_when_work_started == [False], (
        "ANTHROPIC_API_KEY was still set when record processing started — "
        "scrub_environment() must be the first statement in handler()"
    )


def test_extraction_prefix_matches_the_go_side_scheme():
    # Must match apply.ExtractionPrefix (backend/go/internal/apply/apply.go)
    # exactly — both sides compute this independently.
    assert extraction_prefix("user_1", "rec_1") == "extract/user_1/rec_1/"


def test_already_extracted_requires_all_five_files():
    prefix = "extract/user_1/rec_1/"
    assert not already_extracted(set(), prefix)
    assert not already_extracted({prefix + "corrections.json", prefix + "tasks.json"}, prefix)
    # summary.json and speakers.json are mandatory outputs too — missing
    # either must not let a retry skip re-running the agent and forward an
    # incomplete set to applyQueue, where Go's ValidateAll would reject it.
    assert not already_extracted(
        {prefix + "corrections.json", prefix + "tasks.json", prefix + "memories.json"}, prefix,
    )
    assert not already_extracted(
        {
            prefix + "corrections.json",
            prefix + "tasks.json",
            prefix + "memories.json",
            prefix + "summary.json",
        },
        prefix,
    )
    assert already_extracted(
        {
            prefix + "corrections.json",
            prefix + "speakers.json",
            prefix + "tasks.json",
            prefix + "memories.json",
            prefix + "summary.json",
        },
        prefix,
    )


def test_speaker_indices_is_the_set_the_transcript_uses():
    # A set, not a count: the diarizer's numbering need not be contiguous.
    # Matches apply.SpeakerIndices on the Go side.
    transcript = {"utterances": [{"speaker": 0}, {"speaker": 2}, {"speaker": 0}, {"text": "no index"}]}
    assert speaker_indices(transcript) == {0, 2}
    assert speaker_indices({}) == set()


def test_scrub_environment_removes_a_leaked_console_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-leaked")
    scrub_environment()
    assert "ANTHROPIC_API_KEY" not in os.environ


class FakeS3ClientFailingOnNthPut:
    """Stands in for boto3's S3 client. put_object raises on the call
    numbered `fail_on_call` (1-indexed); every call before that succeeds and
    is recorded in .store, exactly like a real bucket would hold it."""

    def __init__(self, fail_on_call):
        self.store = {}
        self.deleted = []
        self.put_calls = 0
        self.fail_on_call = fail_on_call

    def put_object(self, Bucket, Key, Body, ContentType=None):
        self.put_calls += 1
        if self.put_calls == self.fail_on_call:
            raise RuntimeError("simulated put_object failure")
        self.store[Key] = Body

    def delete_object(self, Bucket, Key):
        self.deleted.append(Key)
        self.store.pop(Key, None)


def _write_valid_output_files(workdir):
    with open(f"{workdir}/corrections.json", "wb") as f:
        f.write(b"[]")
    with open(f"{workdir}/speakers.json", "wb") as f:
        f.write(b"[]")
    with open(f"{workdir}/tasks.json", "wb") as f:
        f.write(b"[]")
    with open(f"{workdir}/memories.json", "wb") as f:
        f.write(b"[]")
    with open(f"{workdir}/summary.json", "wb") as f:
        f.write(b'{"title": "Something happened"}')


def test_validate_and_upload_rolls_back_already_written_keys_on_a_failed_put(monkeypatch, tmp_path):
    """The stated constraint is 'a partial set must never reach S3'. A fake
    S3 client fails on the third put_object call (validators run in the
    fixed order corrections, speakers, tasks, memories, summary — so
    corrections.json and speakers.json are already 'in S3' when tasks.json's
    upload blows up).
    Before the fix this reproduced the critical review finding exactly: the
    exception propagates while two of the four files stay behind in the
    fake's store."""
    monkeypatch.setattr(handler, "WORKDIR", str(tmp_path))
    _write_valid_output_files(tmp_path)

    fake = FakeS3ClientFailingOnNthPut(fail_on_call=3)
    monkeypatch.setattr(handler, "s3_client", lambda: fake)

    with pytest.raises(RuntimeError, match="simulated put_object failure"):
        handler.validate_and_upload("bucket", "extract/user_1/rec_1/", utterance_count=0)

    assert fake.store == {}, f"orphaned keys left behind in S3: {sorted(fake.store)}"
