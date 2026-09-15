// Installing the loop that is the integration.
//
// The engine has no LYZN code in it and is not going to: everything LYZN asks
// of a machine happens through a loop, the same way every other integration in
// the registry works. `lyzn-tasks` is that loop — it beats, asks what has been
// approved, claims one, runs it through whatever coding harness this machine
// already has, and posts the outcome back so a receipt can be printed.
//
// What the loop cannot do is get itself a token. So this app, which is a LYZN
// product and does hold a LYZN credential, writes the loop out with the token
// in it the moment somebody signs in, and blanks it when they sign out. That
// is the whole of the wiring between the two halves, and it is why signing in
// here is not merely a login: it is the install step.
//
// Dropping a file in the recipes directory is the entire install. The engine
// watches that directory and picks it up within a few seconds — no restart,
// which is the one thing the recipe tier has over the compiled one.
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { recipesDir } from './profile.js'

/** The file the engine reads, and the name it shows in Automations. */
export const LOOP_ID = 'lyzn-tasks'

function installedPath(): string {
  return path.join(recipesDir(), `${LOOP_ID}.yaml`)
}

/** The copy shipped inside the app.
 *
 *  Kept in step with `recipes/lyzn-tasks.yaml` in the karmax-loops registry by
 *  hand, which is a real cost and the lesser one: fetching it at sign-in would
 *  make pairing need a network round trip to a third place, and would let a
 *  change in a registry nobody here controls alter what runs on somebody's
 *  machine. */
function template(): string | null {
  const roots = app.isPackaged
    ? [path.join(process.resourcesPath, 'loops')]
    : [path.join(app.getAppPath(), 'resources', 'loops')]
  for (const root of roots) {
    const candidate = path.join(root, `${LOOP_ID}.yaml`)
    try {
      return fs.readFileSync(candidate, 'utf8')
    } catch {
      // Next root.
    }
  }
  return null
}

/** The one line the recipe leaves for a token, and what to put in it. */
const TOKEN_LINE = /^(\s*in:\s*)\[""\]\s*$/m

export interface LoopState {
  installed: boolean
  /** The token line is filled in, so this loop will actually do something. */
  armed: boolean
  path: string
}

export function state(): LoopState {
  const at = installedPath()
  try {
    const text = fs.readFileSync(at, 'utf8')
    return { installed: true, armed: !TOKEN_LINE.test(text), path: at }
  } catch {
    return { installed: false, armed: false, path: at }
  }
}

/** Write the loop out with this machine's token in it.
 *
 *  Mode 600, because that file now holds a credential — the same reason the
 *  registry's own instructions end in `chmod 600`. */
export function install(token: string, apiBase?: string): { ok: boolean; error?: string } {
  const text = template()
  if (!text) {
    return { ok: false, error: 'This build shipped without the LYZN loop.' }
  }
  if (!TOKEN_LINE.test(text)) {
    // The recipe changed shape and this substitution no longer applies.
    // Refusing beats writing a loop that quietly does nothing.
    return { ok: false, error: 'The bundled loop no longer has a line for the token.' }
  }

  let out = text.replace(TOKEN_LINE, (_m, prefix: string) => `${prefix}["${token}"]`)
  // A preview stack answers somewhere else. Nothing does this today; it keeps
  // the loop honest about which LYZN it is talking to when something does.
  if (apiBase && apiBase !== 'https://api.lyzn.ai') {
    out = out.split('https://api.lyzn.ai').join(apiBase.replace(/\/+$/, ''))
  }

  try {
    fs.mkdirSync(recipesDir(), { recursive: true })
    fs.writeFileSync(installedPath(), out, { mode: 0o600 })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Take the token away without taking the loop away.
 *
 *  The recipe is written so an empty token skips every step and logs one line,
 *  so this leaves something a person can read and re-arm rather than a hole
 *  where their automation used to be. */
export function disarm(): void {
  const at = installedPath()
  try {
    const text = fs.readFileSync(at, 'utf8')
    fs.writeFileSync(at, text.replace(/^(\s*in:\s*)\[".*"\]\s*$/m, '$1[""]'), { mode: 0o600 })
  } catch {
    // Not installed; nothing to disarm.
  }
}
