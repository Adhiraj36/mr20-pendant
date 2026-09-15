// What each app needs on the machine, and how to put it there.
//
// The app used to detect a missing tool and hand out a link. That is a fair
// answer for a developer and a dead end for everybody else: the person who
// clicked "Connect WhatsApp" wanted WhatsApp connected, not a README about a
// Go toolchain. So connecting an app installs what it needs first.
//
// Still a closed set. The renderer names a tool, never a command line — the
// same rule the pairing flows follow, and for the same reason: a compromised
// page must not be able to ask the main process to run something of its own
// devising. Every command below is written out here in full.
//
// Each tool lists methods in order of preference, and each method names the
// tool it needs to run. If none of them can run, the caller gets back what is
// missing so it can say "install Node.js first" rather than failing at a shell
// prompt nobody is looking at.
import path from 'node:path'
import fs from 'node:fs'
import { profileDir, toolsDir } from './profile.js'

/** The Go release used when a source build is the only way to get a tool.
 *
 *  Pinned rather than "latest": what gets installed on somebody's machine
 *  should not change because a release went out overnight. */
const GO_VERSION = 'go1.27.1'

/** Where an installed Go toolchain ends up, and the bin directory that has to
 *  be on the PATH for it to be usable. */
export function goRoot(): string {
  return path.join(toolsDir(), 'go')
}

export function goBin(): string {
  return path.join(goRoot(), 'bin')
}

/** The steps that put Go on this machine, for the platforms it publishes.
 *
 *  Into the app's own profile, so nothing of the system is touched and no
 *  password is asked for. curl and tar are both present on macOS, on every
 *  Linux worth the name, and on Windows 10 and later.
 */
function installGo(): Step[] {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  const os = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux'
  const archive = `${GO_VERSION}.${os}-${arch}.${os === 'windows' ? 'zip' : 'tar.gz'}`
  const to = path.join(profileDir(), archive)
  return [
    { bin: 'curl', args: ['-fSL', '--progress-bar', `https://go.dev/dl/${archive}`, '-o', to] },
    // tar reads a zip on Windows too, which is why this is one command and not
    // two shapes of the same one.
    { bin: 'tar', args: ['-xf', to, '-C', toolsDir()] },
  ]
}

export type ToolId = 'claude' | 'codex' | 'wacli' | 'gog' | 'playwright'

export interface Step {
  bin: string
  args: string[]
}

export interface Method {
  /** The binary this method needs before it can run. */
  needs: string
  /** What to say we are doing, in a person's words. */
  label: string
  steps: Step[]
}

export interface Install {
  name: string
  /** Why somebody should want it, for the button's confirmation line. */
  why: string
  methods: Method[]
  /** Where to get the thing a method needs, when nothing can run. */
  prerequisite: Record<string, { name: string; url: string }>
}

export const INSTALLS: Record<ToolId, Install> = {
  claude: {
    name: 'Claude Code',
    why: 'It does the thinking.',
    methods: [
      {
        needs: 'npm',
        label: 'Installing Claude Code',
        steps: [{ bin: 'npm', args: ['install', '-g', '@anthropic-ai/claude-code'] }],
      },
    ],
    prerequisite: { npm: { name: 'Node.js', url: 'https://nodejs.org/en/download' } },
  },

  codex: {
    name: 'Codex',
    why: 'An alternative brain, if you would rather use OpenAI.',
    methods: [
      {
        needs: 'npm',
        label: 'Installing Codex',
        steps: [{ bin: 'npm', args: ['install', '-g', '@openai/codex'] }],
      },
    ],
    prerequisite: { npm: { name: 'Node.js', url: 'https://nodejs.org/en/download' } },
  },

  wacli: {
    name: 'WhatsApp',
    why: 'Lets LYZN read and reply on your own WhatsApp account.',
    // A released binary is fetched and checksum-verified first — see
    // fetchtool.ts — and these are the fallback for a platform the project
    // has not built for, or a download that could not be had.
    methods: [
      {
        needs: 'go',
        label: 'Building the WhatsApp bridge',
        steps: [{ bin: 'go', args: ['install', 'github.com/MelloB1989/wacli@latest'] }],
      },
      {
        // No Go on the machine, so fetch one. Nobody should have to install a
        // language toolchain by hand to connect WhatsApp, and telling them to
        // is how this flow dead-ends.
        needs: 'curl',
        label: 'Fetching Go, then building the WhatsApp bridge',
        steps: [
          ...installGo(),
          { bin: path.join(goBin(), 'go'), args: ['install', 'github.com/MelloB1989/wacli@latest'] },
        ],
      },
    ],
    prerequisite: { go: { name: 'Go', url: 'https://go.dev/dl/' }, curl: { name: 'curl', url: '' } },
  },

  gog: {
    name: 'Google',
    why: 'Calendar, Gmail, Drive, Docs and Chat.',
    // gogcli, which is a Go binary rather than an npm package — one fewer
    // runtime on the machine, and the reason the engine moved off gws.
    methods: [
      {
        needs: 'go',
        label: 'Building the Google CLI',
        steps: [{ bin: 'go', args: ['install', 'github.com/openclaw/gogcli/cmd/gog@latest'] }],
      },
      {
        // No Go here, so fetch one. Nobody should have to install a language
        // toolchain by hand to connect their calendar.
        needs: 'curl',
        label: 'Fetching Go, then building the Google CLI',
        steps: [
          ...installGo(),
          { bin: path.join(goBin(), 'go'), args: ['install', 'github.com/openclaw/gogcli/cmd/gog@latest'] },
        ],
      },
    ],
    prerequisite: { go: { name: 'Go', url: 'https://go.dev/dl/' }, curl: { name: 'curl', url: '' } },
  },

  playwright: {
    name: 'Browsing',
    why: 'Lets the assistant open a real browser to read pages and fill things in.',
    methods: [
      {
        // Registered inside Claude Code rather than installed beside it: an
        // MCP server is a thing the harness knows about, and `claude mcp add`
        // is the only supported way to tell it.
        needs: 'claude',
        label: 'Teaching Claude Code to browse',
        steps: [
          { bin: 'claude', args: ['mcp', 'add', 'playwright', '--', 'npx', '-y', '@playwright/mcp@latest'] },
          // The MCP server drives a real browser, and refuses at the moment it
          // is first asked to if there is none. Better a slow install now than
          // a confusing failure the first time somebody asks for a web page.
          { bin: 'npx', args: ['-y', 'playwright', 'install', 'chromium'] },
        ],
      },
    ],
    prerequisite: { claude: { name: 'Claude Code', url: 'https://claude.com/product/claude-code' } },
  },
}

/** Whether a binary is on the given PATH. */
export function which(bin: string, searchPath: string): string | null {
  const names = process.platform === 'win32' ? [bin + '.exe', bin + '.cmd', bin + '.bat', bin] : [bin]
  // The app's own tools directory is searched first and always, whatever PATH
  // the caller was handed — otherwise a tool this app installed would be
  // invisible to the check that decides whether to install it again.
  for (const dir of [toolsDir(), goBin(), goPath(), ...searchPath.split(path.delimiter)]) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      try {
        fs.accessSync(candidate, fs.constants.X_OK)
        return candidate
      } catch {
        // not here; keep looking
      }
    }
  }
  return null
}

/** Where `go install` puts what it builds, which is not where go itself is. */
export function goPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  return process.env.GOBIN?.trim() || path.join(process.env.GOPATH?.trim() || path.join(home, 'go'), 'bin')
}

export type Plan =
  | { ok: true; label: string; steps: Step[] }
  | { ok: false; missing: string; name: string; url: string }

/** How this machine would install a tool, or what it is missing first. */
export function plan(tool: ToolId, searchPath: string): Plan {
  const install = INSTALLS[tool]
  for (const method of install.methods) {
    if (which(method.needs, searchPath)) {
      return { ok: true, label: method.label, steps: method.steps }
    }
  }
  // Nothing could run. Name the first method's prerequisite: the list is in
  // preference order, so that is the one to tell somebody about.
  const first = install.methods[0]
  const need = install.prerequisite[first.needs] ?? { name: first.needs, url: '' }
  return { ok: false, missing: first.needs, name: need.name, url: need.url }
}
