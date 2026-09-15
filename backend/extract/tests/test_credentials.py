import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import credentials


class FakeSecretsManager:
    def __init__(self, secrets):
        self.secrets = secrets
        self.calls = 0

    def get_secret_value(self, SecretId):
        self.calls += 1
        return {"SecretString": self.secrets[SecretId]}


def test_a_bare_string_secret_resolves_directly(monkeypatch):
    fake = FakeSecretsManager({"arn:1": "sk-abc"})
    monkeypatch.setattr(credentials, "_sm_client", lambda: fake)
    credentials._cache.clear()
    assert credentials.resolve("arn:1", [], "test") == "sk-abc"


def test_a_json_secret_tries_fields_in_order(monkeypatch):
    fake = FakeSecretsManager({"arn:2": json.dumps({"token": "t-123"})})
    monkeypatch.setattr(credentials, "_sm_client", lambda: fake)
    credentials._cache.clear()
    assert credentials.resolve("arn:2", ["missing", "token"], "test") == "t-123"


def test_a_second_call_is_cached_and_does_not_refetch(monkeypatch):
    fake = FakeSecretsManager({"arn:3": "sk-once"})
    monkeypatch.setattr(credentials, "_sm_client", lambda: fake)
    credentials._cache.clear()
    credentials.resolve("arn:3", [], "test")
    credentials.resolve("arn:3", [], "test")
    assert fake.calls == 1


def test_the_placeholder_is_refused(monkeypatch):
    fake = FakeSecretsManager({"arn:4": "REPLACE_ME"})
    monkeypatch.setattr(credentials, "_sm_client", lambda: fake)
    credentials._cache.clear()
    try:
        credentials.resolve("arn:4", [], "test")
        assert False, "must raise"
    except RuntimeError as exc:
        assert "placeholder" in str(exc)
