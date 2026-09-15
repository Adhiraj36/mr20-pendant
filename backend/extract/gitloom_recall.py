"""The extraction agent's own Recall tool.

Real tool use during the extraction turn (spec §2): before the agent writes
memories.json, it can ask GitLoom what it already holds for this person, so
it does not restate a fact GitLoom already extracted from an earlier
conversation. This is best-effort dedup — Recall is similarity search, not
exact match, so it will occasionally miss a real duplicate or suppress
something that was not actually a repeat. It is also the only dedup this
pipeline has: nothing written to GitLoom can be deleted or superseded at the
pinned gitloom-go v0.3.4 (RememberOptions.SessionID is write-only, with no
matching filter on Recall).

A plain HTTPS call, not the Go SDK: GitLoom's own REST API is what the SDK
wraps (POST /v1/memories, GET /v1/retrieve, Bearer auth) — this container has
no reason to vendor Go for two REST calls.
"""
import hashlib
import json
import os
import re
import urllib.parse
import urllib.request

from claude_agent_sdk import create_sdk_mcp_server, tool

import credentials

GITLOOM_BASE_URL = os.environ.get("GITLOOM_BASE_URL", "https://api.gitloom.cloud").rstrip("/")

_VALID_NAMESPACE = re.compile(r"^[a-z0-9-]{1,64}$")


def namespace_for(user_id: str) -> str:
    """Mirrors gitloomx.Namespace (backend/go/internal/gitloomx/namespace.go)
    exactly: the id is trimmed of surrounding whitespace first — an untrimmed
    id would hash to a different digest than the same id arriving trimmed
    from the Go side, silently pointing the agent at a namespace the
    pipeline never writes to. A trimmed-empty id returns "" rather than a
    namespace of its own. Otherwise: an already-valid id passes through
    untouched; anything else is folded to lowercase with a short digest of
    the *original* (trimmed) id appended, so folding two ids to the same
    text cannot merge two accounts' memories."""
    user_id = user_id.strip()
    if not user_id:
        return ""
    if _VALID_NAMESPACE.match(user_id):
        return user_id
    head = re.sub(r"[^a-z0-9-]", "-", user_id.lower())
    suffix = "-" + hashlib.sha256(user_id.encode()).hexdigest()[:8]
    if len(head) + len(suffix) > 64:
        head = head[: 64 - len(suffix)]
    return head + suffix


def recall(query_text: str, user_id: str, limit: int = 5) -> list:
    namespace = namespace_for(user_id)
    params = urllib.parse.urlencode({"q": query_text, "namespace": namespace, "limit": limit})
    req = urllib.request.Request(
        f"{GITLOOM_BASE_URL}/v1/retrieve?{params}",
        headers={"Authorization": f"Bearer {credentials.gitloom_api_key()}"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = json.loads(resp.read())
    return body.get("hits", [])


def build_recall_tool(user_id: str):
    """Binds the tool to one recording's user — the agent never chooses a
    namespace, so it can never reach another user's memories no matter what
    it asks."""

    @tool(
        "recall",
        "Search this person's existing memories before writing new ones, to avoid restating what is already known.",
        {"query": str},
    )
    async def recall_tool(args):
        try:
            hits = recall(args["query"], user_id)
        except Exception as exc:  # a Recall outage must not stop extraction
            return {"content": [{"type": "text", "text": f"recall unavailable: {exc}"}]}
        if not hits:
            return {"content": [{"type": "text", "text": "nothing found"}]}
        lines = [f"- {h.get('snippet', '')}" for h in hits[:5]]
        return {"content": [{"type": "text", "text": "\n".join(lines)}]}

    return create_sdk_mcp_server(name="gitloom", version="1.0.0", tools=[recall_tool])
