import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from gitloom_recall import namespace_for


def test_an_already_valid_namespace_passes_through():
    # Mirrors gitloomx.Namespace (backend/go/internal/gitloomx/namespace.go):
    # lowercase letters, digits and '-', up to 64 chars, already qualifies.
    assert namespace_for("already-valid-123") == "already-valid-123"


def test_a_clerk_subject_is_folded_with_a_digest_suffix():
    ns = namespace_for("user_3J3fsbqIQhi6mqtfNj0JknPdOtO")
    assert ns.startswith("user-3j3fsbqiqhi6mqtfnj0jknpdoto-") or ns.startswith("user-")
    assert len(ns) <= 64
    # Stable: the same input always lands in the same namespace.
    assert ns == namespace_for("user_3J3fsbqIQhi6mqtfNj0JknPdOtO")


def test_two_ids_differing_only_by_case_land_in_different_namespaces():
    a = namespace_for("User_ABC")
    b = namespace_for("user_abc")
    assert a != b


def test_a_whitespace_padded_id_lands_in_the_same_namespace_as_trimmed():
    # gitloomx.Namespace calls strings.TrimSpace(userID) before validating
    # and hashing (backend/go/internal/gitloomx/namespace.go). If the Python
    # side skipped that trim, a padded id would hash to a different digest
    # than the same id arriving untrimmed from the Go side, and the agent
    # would silently recall from a namespace the pipeline never writes to.
    assert namespace_for("  already-valid-123  ") == "already-valid-123"
    assert namespace_for("  user_3J3fsbqIQhi6mqtfNj0JknPdOtO  ") == namespace_for(
        "user_3J3fsbqIQhi6mqtfNj0JknPdOtO"
    )


def test_an_empty_or_all_whitespace_id_returns_empty_string():
    # gitloomx.Namespace returns "" for an empty (post-trim) userID rather
    # than inventing a namespace for "nobody" to write to.
    assert namespace_for("") == ""
    assert namespace_for("   ") == ""
