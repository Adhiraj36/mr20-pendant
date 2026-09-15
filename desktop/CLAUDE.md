# Notes for whoever works on this next

**This is a LYZN product wrapped around somebody else's engine.** The window,
the words and the theme are LYZN's; the thing they supervise is KARMAX, which
lives in its own repository and is not ours to change. That split is deliberate
and it decides most arguments here: if something is wrong with what the engine
*does*, the fix belongs in KARMAX; if it is wrong with what a person sees or
how it is packaged, it belongs here.

**No engine source is in this directory.** The daemon is built from
`$KARMAX_SRC` by `scripts/build-core.sh` and bundled as a binary, one per
platform. The UI must stay buildable on a machine with no Go toolchain.

**The name KARMAX never appears on screen.** It is the true name of the binary
and the config file, so code and comments use it where they mean those; a
person setting this up is using LYZN, and the engine underneath is an
implementation detail they did not ask about.

**The audience is a non-technical person.** No jargon on screen. "The engine",
not "the daemon"; "the brain", not "the harness"; "Apps", not "connectors". A
label that would need a footnote is the wrong label. Errors say what to do next.

**Comments are sparse — one line where the reason is not obvious from the code**,
and they explain *why*, usually by naming the failure the code prevents. Do not
narrate what a line does.

**Never let the renderer hold a credential.** The API token can invoke
`shell.exec`; it lives in the main process and the page names intents instead.
`hosttools.ts` runs a closed set of commands by name for the same reason — the
UI can ask to pair WhatsApp, never to run a command line of its own devising.

**Config edits go through the YAML document API**, not parse-and-dump. People
edit `karmax.yaml` by hand too, and a toggle that eats their comments is a bug.
The one exception is `comms.channels`, rewritten as text in `ChannelSetup.tsx`,
because `setIn` on a sequence of maps reformats every entry.

**Two daemons must never share a data dir.** That is why the profile defaults to
`~/.karmax-desktop`, why `start()` checks the port before spawning, and why the
pidfile exists. If you touch `daemon.ts`, re-read the adoption path first.

**Run `npm run test:core` after touching anything in `electron/`.** It starts a
real daemon; a mock would not have caught the two bugs it has caught so far (the
agent tool allowlist missing the `harness.*` tools, and the ESM `require` shim).

**`writeEnvFile` merges; it never truncates.** The daemon rewrites the profile
`.env` on every start, and that file is the only way to configure what karmax
reads from the environment — GitLoom among them. Truncating it means somebody's
memory credentials disappearing on a restart, silently.

**Two ids can mean one service.** Google arrives as `google_workspace` (a CLI
session) and `google` (an OAuth connector); Slack as both a connector and a chat
channel. `canonical()` in `apps/catalogue.ts` folds them, and the Apps page
shows each service once, in the section where it is actually set up. Adding an
alias there is cheaper than explaining to someone why one app is "Connected" and
"Not set up" at the same time.

**Brand marks are generated, not pasted.** `npm run brands` writes
`apps/brands.ts` from simple-icons. Do not hand-add a path for a brand that is
absent from that set — Slack, LinkedIn and YouTrack are absent because their
owners asked to be, and the letter-tile fallback is the correct answer.

**Design tokens live in `src/styles/theme.css`** and the reasoning is in the
comment at the top of it. The palette is LYZN's, imported from
`@lyzn/design/tokens.css` — the same desk the phone sits on. Light is the
design and night is the option, nothing glows, corners are square, and stamp
violet means the live action while settled green, carbon and void red mean
machine state.

Every route is written against the role variables — `--fg-dim`, `--skin-2`,
`--accent` — rather than against colours, which is why the whole window
re-skinned from one file. Keep it that way: a hex in a route is a colour that
will be wrong in the other theme.

**Fonts are bundled, not fetched.** The page loads over `file://` with
`connect-src 'none'`, and a machine that runs your work whether or not you have
a network must not need one to look like itself.
