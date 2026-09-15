"""Credentials from Secrets Manager, cached for the container's life.

Mirrors backend/go/internal/config.Resolve (internal/config/config.go): a
Lambda container is reused, so a secret fetched once should not be
re-fetched on every invocation, and a secret holding a JSON object tries a
list of field names in order. Named credentials.py rather than secrets.py —
Python's own stdlib `secrets` module would otherwise be shadowed for
anything else in this container that imports it.
"""
import json
import os

import boto3

_cache: dict[str, str] = {}
_client = None

PLACEHOLDER = "REPLACE_ME"


def _sm_client():
    global _client
    if _client is None:
        _client = boto3.client("secretsmanager")
    return _client


def resolve(arn: str, fields: list[str], name: str) -> str:
    if arn in _cache:
        return _cache[arn]
    raw = _sm_client().get_secret_value(SecretId=arn)["SecretString"]
    value = raw
    if raw.strip().startswith("{"):
        parsed = json.loads(raw)
        value = ""
        for field in fields:
            if parsed.get(field):
                value = parsed[field]
                break
        if not value:
            raise RuntimeError(f"{name}: secret holds none of {fields}")
    if value == PLACEHOLDER:
        raise RuntimeError(f"{name}: still holds the placeholder the stack created it with")
    _cache[arn] = value
    return value


def claude_oauth_token() -> str:
    return resolve(os.environ["CLAUDE_OAUTH_SECRET_ARN"], ["token"], "Claude Code OAuth token")


def gitloom_api_key() -> str:
    return resolve(os.environ["GITLOOM_SECRET_ARN"], ["apiKey", "GITLOOM_API_KEY", "key"], "GitLoom API key")
