"""ExtractFn: runs Claude Code over one recording's transcript and writes the
extraction agent's five output files (corrections, speakers, tasks, memories,
summary).

Consumes extractQueue at batchSize 1. Each message is a
types.ExtractionRequest (backend/go/internal/types/types.go) as JSON. On
success this handler re-serializes the same fields onto applyQueue; on
exhausted retries the message reaches extractQueue's own DLQ, which ApplyFn
consumes directly and treats identically (internal/apply.ExtractionPrefix).
"""
import asyncio
import json
import logging
import os
import shutil

import boto3

import credentials

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("extract")
# basicConfig() above is a no-op under the Lambda runtime: awslambdaric's
# bootstrap.run() already installed a handler on the root logger before this
# module is even imported, and never raises root's level off its WARNING
# default (AWS_LAMBDA_LOG_LEVEL is unset), so INFO records from this named
# logger are filtered before creation unless its own level is set here.
log.setLevel(logging.INFO)

WORKDIR = "/tmp/work"

_s3 = None
_sqs = None


def s3_client():
    global _s3
    if _s3 is None:
        _s3 = boto3.client("s3")
    return _s3


def sqs_client():
    global _sqs
    if _sqs is None:
        _sqs = boto3.client("sqs")
    return _sqs


def scrub_environment() -> None:
    """Removes ANTHROPIC_API_KEY before the SDK ever sees it.

    options.env is merged on top of the inherited environment and the SDK
    never unsets this key itself — so a stray Console key in the function's
    own environment would silently bill that account instead of using the
    subscription OAuth token. Called first, before anything else touches
    os.environ.
    """
    os.environ.pop("ANTHROPIC_API_KEY", None)


def prepare_workdir() -> None:
    """/tmp survives a warm Lambda container across invocations; wipe it so
    a second recording never inherits the first one's files."""
    shutil.rmtree(WORKDIR, ignore_errors=True)
    os.makedirs(WORKDIR, exist_ok=True)


def extraction_prefix(user_id: str, recording_id: str) -> str:
    # Must match apply.ExtractionPrefix on the Go side (internal/apply) —
    # both compute this independently; see that function's comment.
    return f"extract/{user_id}/{recording_id}/"


def already_extracted(existing_keys: set, prefix: str) -> bool:
    """True once all five output files exist at prefix, so a Lambda retry
    that lost the race between S3 upload and returning success does not pay
    for a second agent run to produce output already sitting in S3.

    All five — summary.json and speakers.json included — must be present:
    validate_and_upload uploads all-or-nothing, so an attempt that crashed
    partway through never leaves fewer than five files sitting at this
    prefix. Treating four as good enough would let a retry skip re-running
    the agent and forward an incomplete set to applyQueue, where Go's
    ValidateAll rejects the whole extraction with no distinction from an
    ordinary fallback."""
    required = {
        prefix + "corrections.json",
        prefix + "speakers.json",
        prefix + "tasks.json",
        prefix + "memories.json",
        prefix + "summary.json",
    }
    return required.issubset(existing_keys)


def existing_keys_under(bucket: str, prefix: str) -> set:
    resp = s3_client().list_objects_v2(Bucket=bucket, Prefix=prefix)
    return {obj["Key"] for obj in resp.get("Contents", [])}


def download_transcript(bucket: str, key: str) -> dict:
    body = s3_client().get_object(Bucket=bucket, Key=key)["Body"].read()
    return json.loads(body)


def enqueue_apply(queue_url: str, req: dict) -> None:
    sqs_client().send_message(QueueUrl=queue_url, MessageBody=json.dumps(req))


def speaker_indices(transcript: dict) -> set:
    """The diarizer indices the transcript actually uses — the only ones
    speakers.json may describe. Matches apply.SpeakerIndices on the Go side."""
    return {
        u["speaker"] for u in transcript.get("utterances", [])
        if isinstance(u, dict) and isinstance(u.get("speaker"), int)
    }


def validate_and_upload(bucket: str, prefix: str, utterance_count: int, speakers: set = frozenset()) -> None:
    """Reads the five files the agent wrote to WORKDIR, validates each
    against its contract, and uploads only once all five pass — a partial
    upload would let ApplyFn see four good files and one it can never trust
    came from a matching run."""
    from schemas import (
        ValidationError, validate_corrections, validate_memories, validate_speakers,
        validate_summary, validate_tasks,
    )

    validators = {
        "corrections.json": lambda raw: validate_corrections(raw, utterance_count),
        "speakers.json": lambda raw: validate_speakers(raw, speakers),
        "tasks.json": validate_tasks,
        "memories.json": validate_memories,
        "summary.json": validate_summary,
    }
    bodies = {}
    for name, validate in validators.items():
        path = f"{WORKDIR}/{name}"
        if not os.path.exists(path):
            raise ValidationError(f"{name}: the agent did not write this file")
        with open(path, "rb") as f:
            raw = f.read()
        validate(raw)  # raises ValidationError if the content is bad
        bodies[name] = raw

    uploaded = []
    try:
        for name, raw in bodies.items():
            key = prefix + name
            s3_client().put_object(Bucket=bucket, Key=key, Body=raw, ContentType="application/json")
            uploaded.append(key)
    except Exception:
        # The upload loop itself is not atomic — five independent
        # put_object calls, no transaction. If one fails partway through,
        # best-effort delete whatever already landed so a partial set does
        # not sit in S3 accumulating. This is a cleanup, not the guarantee:
        # already_extracted requiring all five keys is what actually makes
        # a retry safe (a set missing even one file is never mistaken for
        # complete, whether or not this delete succeeds). So a failed
        # delete here must never mask the original upload error — it is
        # only logged, by key name, and the original exception still
        # propagates.
        _cleanup_partial_upload(bucket, uploaded)
        raise


def _cleanup_partial_upload(bucket: str, keys: list) -> None:
    """Best-effort delete of keys already written before an upload failure.
    Swallows its own failures: the caller is inside an except block and
    must re-raise the original exception regardless of what happens here."""
    for key in keys:
        try:
            s3_client().delete_object(Bucket=bucket, Key=key)
        except Exception:
            log.error("could not clean up orphaned upload key=%s", key)


def log_result(message, recording_id: str) -> None:
    """Logs the one ResultMessage a turn ends with. total_cost_usd, usage
    and model_usage are what show whether the subscription OAuth token is
    holding up under load — dropped on the floor in the original scaffold,
    logged here per extraction rather than only discoverable by re-running
    one by hand.

    Every attribute is read via getattr(..., None): claude-agent-sdk
    (requirements.txt) is pinned with no upper bound, so a future release's
    ResultMessage can drop or rename one of these fields. That must degrade
    this log line to a partial one, not raise — an AttributeError here
    would propagate out of turn() -> run_one() -> handler()'s bare except
    Exception and fail (and re-bill) the whole extraction just to retry a
    log line."""
    fields = (
        "recordingId=%s sessionId=%s cost_usd=%s usage=%s model_usage=%s"
        % (
            recording_id,
            getattr(message, "session_id", None),
            getattr(message, "total_cost_usd", None),
            getattr(message, "usage", None),
            getattr(message, "model_usage", None),
        )
    )
    if getattr(message, "is_error", None):
        log.error("extraction turn ended in error %s", fields)
    else:
        log.info("extraction turn finished %s", fields)


async def run_one(req: dict, remaining_ms: int) -> None:
    """req is one parsed extractQueue message: userId, recordingId,
    startedAt, transcriptKey, speakers."""
    bucket = os.environ["AUDIO_BUCKET"]
    prefix = extraction_prefix(req["userId"], req["recordingId"])

    if already_extracted(existing_keys_under(bucket, prefix), prefix):
        log.info("already extracted recordingId=%s, re-forwarding to applyQueue", req["recordingId"])
        enqueue_apply(os.environ["APPLY_QUEUE_URL"], req)
        return

    prepare_workdir()
    transcript = download_transcript(bucket, req["transcriptKey"])
    with open(f"{WORKDIR}/transcript.json", "w") as f:
        json.dump(transcript, f)
    with open(f"{WORKDIR}/alt.txt", "w") as f:
        f.write(transcript.get("altText", ""))

    budget_seconds = max(remaining_ms / 1000 - 20, 10)
    token = credentials.claude_oauth_token()

    async def turn():
        from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

        from gitloom_recall import build_recall_tool
        from prompt import ALLOWED_TOOLS, MODEL, SYSTEM_PROMPT, build_prompt

        options = ClaudeAgentOptions(
            cwd=WORKDIR,
            system_prompt=SYSTEM_PROMPT,
            model=MODEL,
            permission_mode="bypassPermissions",
            setting_sources=[],
            allowed_tools=ALLOWED_TOOLS,
            mcp_servers={"gitloom": build_recall_tool(req["userId"])},
            env={"CLAUDE_CODE_OAUTH_TOKEN": token},
        )
        prompt_text = build_prompt(
            f"{WORKDIR}/transcript.json", f"{WORKDIR}/alt.txt", req.get("categories") or [],
        )
        async for message in query(prompt=prompt_text, options=options):
            if isinstance(message, ResultMessage):
                log_result(message, req["recordingId"])

    await asyncio.wait_for(turn(), timeout=budget_seconds)
    validate_and_upload(bucket, prefix, len(transcript.get("utterances", [])), speaker_indices(transcript))
    enqueue_apply(os.environ["APPLY_QUEUE_URL"], req)


def handler(event, context):
    scrub_environment()
    failures = []
    for record in event.get("Records", []):
        try:
            req = json.loads(record["body"])
        except (KeyError, json.JSONDecodeError) as exc:
            log.error("unparseable message id=%s err=%s", record.get("messageId"), exc)
            continue
        try:
            asyncio.run(run_one(req, context.get_remaining_time_in_millis()))
        except asyncio.TimeoutError:
            log.error("time budget exhausted recordingId=%s", req.get("recordingId"))
            failures.append({"itemIdentifier": record["messageId"]})
        except Exception:
            log.exception("extraction failed recordingId=%s", req.get("recordingId"))
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
