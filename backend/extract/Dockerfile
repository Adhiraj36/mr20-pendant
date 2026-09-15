# public.ecr.aws/lambda/python:3.13 — Amazon Linux 2023, glibc. The bundled
# claude_agent_sdk CLI binary (claude_agent_sdk/_bundled/claude, ~207 MB, a
# platform-specific ELF the pip wheel carries) is glibc-linked and fails to
# start on an Alpine/musl base with nothing more than "failed to start
# Claude Code" — there is no more specific error to debug from.
FROM public.ecr.aws/lambda/python:3.13

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY handler.py credentials.py prompt.py gitloom_recall.py schemas.py ${LAMBDA_TASK_ROOT}/

# The CLI writes config, transcripts and lockfiles under $HOME on startup,
# and Lambda's own default HOME is read-only. CLAUDE_CODE_DISABLE_AUTO_MEMORY
# turns off a CLI feature this pipeline has its own memory path for
# (GitLoom) and does not want the CLI writing files for on every turn.
ENV HOME=/tmp \
    CLAUDE_CONFIG_DIR=/tmp/.claude \
    CLAUDE_CODE_DISABLE_AUTO_MEMORY=1

CMD ["handler.handler"]
