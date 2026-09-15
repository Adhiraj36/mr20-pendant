// The PATH a terminal would have.
//
// An app launched from a dock or a .desktop file inherits a minimal
// environment, and the harness binary — `claude`, installed by a version
// manager into a home directory — is exactly the kind of thing missing from
// it. Without this the daemon starts fine and then reports the brain as
// unavailable, which is the most confusing failure this app could have.
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

let cached: Promise<string> | null = null

export function loginPath(): Promise<string> {
  if (cached) return cached
  cached = resolve()
  return cached
}

async function resolve(): Promise<string> {
  const inherited = process.env.PATH ?? ''
  if (process.platform === 'win32') return inherited

  const shell = process.env.SHELL || '/bin/bash'
  let discovered = ''
  try {
    const { stdout } = await execFileAsync(shell, ['-ilc', 'printf %s "$PATH"'], {
      timeout: 5000,
      encoding: 'utf8',
    })
    discovered = stdout.trim()
  } catch {
    // Non-interactive shells, restricted shells, missing rc files: fall
    // through to the static list, which covers the common installers.
  }

  const home = process.env.HOME ?? ''
  const extras = [
    `${home}/.local/bin`,
    `${home}/.bun/bin`,
    `${home}/.claude/local`,
    `${home}/.npm-global/bin`,
    `${home}/go/bin`,
    `${home}/bin`,
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
  ]

  const parts = [...discovered.split(path.delimiter), ...inherited.split(path.delimiter), ...extras]
  const seen = new Set<string>()
  return parts.filter((p) => p && !seen.has(p) && seen.add(p)).join(path.delimiter)
}
