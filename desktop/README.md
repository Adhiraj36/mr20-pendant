# LYZN Daemon

The half of LYZN that keeps the promises. LYZN hears a conversation, notices
what you committed to, and shows it to you; when you approve one, somebody
still has to do it — and that takes a shell, your files and the accounts you
are already signed into, none of which exist in a cloud that only heard the
sentence. This is the app that does it, on your own machine.

Under it runs [KARMAX](https://github.com/MelloB1989/KARMAX), a Go daemon: an
always-on orchestrator with memory, scheduled automations and real tools. That
engine is its own product and its own repository — **no engine source lives
here**. It is built from a checkout you point at, bundled as a binary, and its
name never appears on screen, because the person setting this up is using
LYZN.

## Building it

```bash
npm install
KARMAX_SRC=../path/to/KARMAX npm run build:core   # the engine, for this machine
npm run dev                                        # the app
```

Packaging for all three platforms happens on one runner each — the engine needs
cgo, so a Linux binary cannot honestly be built on a Mac. See
`.github/workflows/desktop-release.yml`; macOS is the exception, where one
runner builds both architectures because the SDK carries both.

## What it is for

Someone who is not going to write YAML, read a log, or run `systemctl`. Every
screen answers a question in that person's words:

| Screen | Answers |
|---|---|
| **Overview** | Is it running, what is it thinking with, what has it been doing |
| **Apps** | What is connected, and how do I connect the rest |
| **Automations** | What does it do without being asked |
| **Memory** | What does it remember |
| **Settings** | Everything configurable, ending in the raw file for when you need it |

A coding harness — Claude Code by default — is the orchestrator. Not an option
buried in a tab: it is what a new install is configured for, with the metered
API path present only as a fallback.

## Architecture

```
┌─ Electron main (Node) ─────────────────────────────────┐
│  daemon.ts    spawns/watches/adopts the KARMAX binary  │
│  profile.ts   its own data dir, ports, token, pidfile  │
│  config.ts    karmax.yaml, edited without losing       │
│               comments (YAML document API)             │
│  api.ts       both HTTP surfaces; holds every token    │
│  hosttools.ts wacli / gws pairing, streamed to the UI  │
└────────────────────────┬───────────────────────────────┘
                         │ contextBridge, sandboxed
┌────────────────────────┴───────────────────────────────┐
│  Renderer (React 19 + Vite + Tailwind v4)              │
│  Names an intent. Never sees a credential.             │
└────────────────────────────────────────────────────────┘
                         │ 127.0.0.1
                  ┌──────┴───────┐
                  │ karmax start │  bundled Go daemon
                  └──────────────┘
```

### Memory

Long-term memory is either a file on this machine or a **GitLoom** namespace,
and karmax picks between them on the presence of `GITLOOM_API_KEY` in its
environment — not on anything in `karmax.yaml`. So Settings › Memory writes to
the profile's `.env`, and `writeEnvFile` **merges** rather than truncates:
the daemon rewrites that file on every start, and a truncating rewrite would
have made GitLoom credentials vanish on the next restart.

The two backends are presented differently because they are different shapes. A
local memory is a chronological log — newest first, with times. A GitLoom memory
is a filed tree: the id *is* the path, the content is a summary, and a survey
carries no timestamp at all. So those are grouped by folder, dated from the path
when it says one, and never shown a fabricated time.

### Brand marks

Real logos come from [simple-icons](https://simpleicons.org) (CC0), generated
into `src/routes/apps/brands.ts` at build time so the bundle carries a dozen
paths instead of three thousand. Slack, LinkedIn and YouTrack asked to be
removed from that set, so they fall back to a letter tile in their own brand
colour — there is no honest way to ship those marks.

Every mark sits on a tint of its brand colour rather than a filled square: a
grid of saturated logos fights the interface. Near-black brands (GitHub, Notion,
X) are lifted toward white on the dark theme, because drawn faithfully they
disappear.

Two decisions worth knowing about:

**It runs its own KARMAX.** The profile is `~/.karmax-desktop`, not `~/.karmax`,
on its own ports (9191 / 8181 / 9190). A machine can already be running a
KARMAX — a systemd unit, a terminal — and KARMAX's own rule is one daemon per
database, because crash recovery at startup assumes nothing else is reading the
same rows. Two instances sharing a data dir do not conflict loudly; they corrupt
quietly and answer as each other. Set `KARMAX_DESKTOP_PROFILE` to point
somewhere else on purpose.

**It adopts its own orphans.** If the app is killed without a chance to clean up,
the daemon it started keeps running and holds the port. On the next launch the
app checks the pidfile and pings the port; if both say the process is its own, it
takes it back over instead of refusing to start or starting a second one.

## Running it

```bash
npm install
KARMAX_SRC=~/code/KARMAX npm run build:core   # needs Go; builds the daemon
npm run dev                                    # Vite + esbuild watch + Electron
```

`build:core` is deliberately not part of `npm run build`, so the UI stays
buildable on a machine with no Go toolchain and no KARMAX checkout.

| Script | |
|---|---|
| `npm run dev` | Everything, watched, with Electron restarted on main-process changes |
| `npm run build` | Electron bundles + renderer |
| `npm run build:core` | The KARMAX daemon, from `$KARMAX_SRC` (default `~/code/KARMAX`) |
| `npm run test:core` | Integration test: real config, real daemon, both APIs |
| `npm run typecheck` | Both TypeScript projects |
| `npm run icons` | Regenerate the app icon set (drawn in code, `scripts/make-icons.py`) |
| `npm run brands` | Regenerate `src/routes/apps/brands.ts` from simple-icons |
| `npm run package` | Installers into `release/` |

### The integration test

`npm run test:core` is the one that matters. It writes a config, starts the
bundled daemon on a throwaway profile, and asks it questions over both HTTP
surfaces — so the generated YAML, the token handshake, the console auto-login
and the supervisor's state machine are all checked against a real KARMAX rather
than a mock.

```
ok    the harness is on by default
ok    comments survived the patch
ok    the daemon reached running        — running: Running.
ok    harness.list runs
ok    the console signs itself in and lists connectors — 10 connectors
```

## Environment

| Variable | |
|---|---|
| `KARMAX_DESKTOP_PROFILE` | Where the app keeps its KARMAX (default `~/.karmax-desktop`) |
| `KARMAX_BINARY` | Use this daemon instead of the bundled one |
| `KARMAX_SRC` | Where `build:core` finds karmax's `go.mod` |
| `KARMAX_DEV_SERVER` | Set by `npm run dev`; makes the window load Vite |

## Requirements

- Node 20+, npm
- Go 1.23+ and a KARMAX checkout, to build the daemon
- Claude Code (or Codex) installed and signed in — this is the brain
- Optional: `wacli` for WhatsApp, `gws` for Google Workspace

## Licence

MIT.
