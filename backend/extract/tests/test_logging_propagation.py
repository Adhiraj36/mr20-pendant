"""Reproduces the production observability bug found via CloudWatch: ExtractFn
ran for real (RequestId d41da63b-08a4-51e3-85c9-c51aa1f11be5) but its log
group held only the runtime's own START/END/REPORT lines -- nothing from
log_result, which is how the operator watches the Claude subscription
token's shared rate limits under load.

Root cause, confirmed against awslambdaric 4.0.3's own source
(awslambdaric/bootstrap.py): `run()` calls `_setup_logging()` -- which adds
a handler to the ROOT logger -- before it calls `_get_handler()`, which is
what imports handler.py for the first time. Because the root logger already
has a handler by then, handler.py's module-level `logging.basicConfig(...)`
is a no-op (basicConfig only acts when the root logger has zero handlers).
And because this deployment never sets AWS_LAMBDA_LOG_LEVEL,
`_setup_logging` never calls `logger.setLevel(...)` either, so root stays at
its interpreter default of WARNING. The "extract" logger's own level is
never set to INFO by anything -- it just inherits root's WARNING through the
normal effective-level walk -- so every log.info() call in handler.py is
filtered out before a record is even created.

This test reproduces that exact import order directly (rather than relying
on pytest's own logging plugin happening to also pre-install root handlers,
which it does, but that's incidental and not what makes this a faithful
repro) by installing a handler on the root logger at WARNING and *then*
(re-)importing handler.py, mimicking bootstrap.run()'s ordering.
"""
import importlib
import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import handler as extract_handler  # noqa: E402  (path insert must come first)


class _CapturingHandler(logging.Handler):
    """Stands in for awslambdaric's LambdaLoggerHandler: a plain handler
    with no level of its own (NOTSET, i.e. processes anything that reaches
    it), so the test asserts on logger-level filtering only -- exactly the
    thing that broke in production."""

    def __init__(self):
        super().__init__()
        self.records = []

    def emit(self, record):
        self.records.append(record)


class _FakeResultMessage:
    def __init__(self):
        self.total_cost_usd = 0.02
        self.usage = {"input_tokens": 10, "output_tokens": 5}
        self.model_usage = {"claude-sonnet-4-5": {"input_tokens": 10}}
        self.is_error = False
        self.session_id = "sess_repro"


def test_info_from_extract_logger_reaches_a_handler_installed_before_import():
    """Reproduces the Lambda condition: a handler lands on the root logger,
    at the root's WARNING default, before handler.py is (re-)imported --
    exactly awslambdaric's bootstrap.run() ordering (_setup_logging, then
    _get_handler's import of the handler module). log_result's INFO line
    must still reach that handler.

    Cleans up root-logger state in `finally` so this cannot leak into other
    tests: original handlers and level are restored, and handler.py is
    reloaded once more afterward so its module-level state (the `log`
    object's level) ends up exactly as it would from a normal import.
    """
    root = logging.getLogger()
    saved_handlers = list(root.handlers)
    saved_level = root.level

    capture = _CapturingHandler()
    try:
        for h in list(root.handlers):
            root.removeHandler(h)
        root.setLevel(logging.WARNING)
        root.addHandler(capture)  # mimics bootstrap.py's _setup_logging(), called before the handler module is imported

        importlib.reload(extract_handler)  # re-runs handler.py's module-level logging setup, as a cold Lambda import would

        extract_handler.log_result(_FakeResultMessage(), "rec_repro")

        info_records = [r for r in capture.records if r.levelno == logging.INFO]
        assert any("rec_repro" in r.getMessage() for r in info_records), (
            "log_result's INFO record never reached the handler that was "
            "installed on the root logger before handler.py was imported -- "
            "this is the production bug: basicConfig() is a no-op once the "
            "root logger already has a handler, so the extract logger's "
            "effective level is left at root's WARNING default"
        )
    finally:
        root.removeHandler(capture)
        for h in list(root.handlers):
            root.removeHandler(h)
        for h in saved_handlers:
            root.addHandler(h)
        root.setLevel(saved_level)
        importlib.reload(extract_handler)
