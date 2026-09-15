// Putting a released binary on the machine, without a toolchain.
//
// Building wacli from source works and is what this app did first, but it asks
// for a Go toolchain that most people do not have and should not have to get
// in order to connect WhatsApp. wacli publishes a binary per platform with a
// SHA-256 beside it, so the ordinary path is: download it, check it against the
// hash the project published, and put it where this app keeps its tools.
//
// Verified, not trusted. A downloaded executable that is about to be run with
// the user's own WhatsApp session is exactly the thing to check, and a
// mismatch is a hard failure rather than a warning — the only safe reading of
// a bad hash is that this is not the file the project released.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { toolsDir } from './profile.js'

export interface Release {
  /** Where the binary lives, per platform-arch as Node names them. */
  url: string
  /** The published SHA-256, either inline or at a URL beside the binary. */
  sha256Url?: string
  sha256?: string
}

/** A tool this app can fetch rather than build. */
export interface Fetchable {
  /** The name it must have on disk to be found later. */
  bin: string
  /** Keyed `${process.platform}-${process.arch}`. Absent means: build it. */
  releases: Record<string, Release>
}

export const FETCHABLE: Record<string, Fetchable> = {
  wacli: {
    bin: 'wacli',
    releases: Object.fromEntries(
      // Only what v0.3.0 actually published. Linux on ARM and Windows are
      // absent, and listing them here would point those machines at a 404 —
      // they take the build path instead, which is what it is for.
      (
        [
          ['darwin-arm64', 'wacli-darwin-arm64'],
          ['darwin-x64', 'wacli-darwin-amd64'],
          ['linux-x64', 'wacli-linux-amd64'],
        ] as const
      ).map(([key, file]) => {
        // Pinned to a release rather than "latest": what runs on somebody's
        // machine should not change because a tag moved overnight.
        const base = 'https://github.com/MelloB1989/wacli/releases/download/v0.3.0/'
        return [key, { url: base + file, sha256Url: base + file + '.sha256' }]
      }),
    ),
  },
}

export function releaseFor(tool: string): Release | null {
  const entry = FETCHABLE[tool]
  if (!entry) return null
  return entry.releases[`${process.platform}-${process.arch}`] ?? null
}

/** Where a fetched tool ends up. */
export function installedAt(tool: string): string {
  const entry = FETCHABLE[tool]
  const name = entry?.bin ?? tool
  return path.join(toolsDir(), process.platform === 'win32' ? name + '.exe' : name)
}

async function publishedHash(release: Release): Promise<string | null> {
  if (release.sha256) return release.sha256.toLowerCase()
  if (!release.sha256Url) return null
  const res = await fetch(release.sha256Url, { redirect: 'follow' })
  if (!res.ok) return null
  // The file is either a bare hash or the `sha256sum` two-column form.
  const text = (await res.text()).trim()
  const first = text.split(/\s+/)[0]?.toLowerCase() ?? ''
  return /^[0-9a-f]{64}$/.test(first) ? first : null
}

/** Download, verify, and put it in place. Reports progress as sentences. */
export async function fetchTool(
  tool: string,
  say: (line: string) => void,
): Promise<{ ok: boolean; error?: string; path?: string }> {
  const release = releaseFor(tool)
  if (!release) {
    return { ok: false, error: `no released build of ${tool} for this machine` }
  }

  say(`Downloading ${tool}…\n`)
  const res = await fetch(release.url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    return { ok: false, error: `the download answered ${res.status}` }
  }
  const bytes = Buffer.from(await res.arrayBuffer())
  say(`Downloaded ${(bytes.length / 1048576).toFixed(1)} MB.\n`)

  const expected = await publishedHash(release)
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (!expected) {
    return { ok: false, error: 'the project published no checksum for this build' }
  }
  if (expected !== actual) {
    // Not a warning. The only safe reading is that this is not the file the
    // project released, and it is about to be run with somebody's WhatsApp.
    return { ok: false, error: 'the download did not match its published checksum' }
  }
  say('Checksum matches what the project published.\n')

  const target = installedAt(tool)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  // Written beside and renamed, so an interrupted download never leaves a
  // half-file that looks installed.
  const temp = target + '.part'
  fs.writeFileSync(temp, bytes, { mode: 0o755 })
  fs.renameSync(temp, target)
  say(`Installed to ${target}\n`)
  return { ok: true, path: target }
}
