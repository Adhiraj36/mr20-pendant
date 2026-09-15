// Guards install()'s preconditions against the bundled recipe drifting out
// from under it: exactly one line for install() to fill the daemon token
// into, and https://api.lyzn.ai still the base URL it rewrites when a
// caller passes another.
//
// Run with `npm run test:loops`. Like test:core, it points
// KARMAX_DESKTOP_PROFILE at a throwaway directory (see scripts/test-loops.mjs)
// and never touches a real ~/.karmax-desktop — that is where a live daemon
// token lives once someone has actually signed in, and this must not read
// or overwrite it.
import fs from 'node:fs'
import path from 'node:path'
import { disarm, install, LOOP_ID, state } from '../electron/loops.js'
import { recipesDir } from '../electron/profile.js'

let failures = 0
function ok(label: string, cond: boolean, extra = ''): void {
  if (!cond) failures++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`)
}

const installedPath = path.join(recipesDir(), `${LOOP_ID}.yaml`)

const before = state()
ok('nothing installed in the throwaway profile yet', before.installed === false)

const result = install('test-token-do-not-use', 'https://api.lyzn.ai')
ok('install() accepted the bundled template', result.ok === true, result.error ?? '')

const written = fs.readFileSync(installedPath, 'utf8')
ok('the token was substituted in', written.includes('in: ["test-token-do-not-use"]'))
ok('no empty token line is left over — TOKEN_LINE matched exactly once', !/^\s*in:\s*\[""\]\s*$/m.test(written))
ok('the default base URL is left as-is', written.includes('https://api.lyzn.ai'))

const armed = state()
ok('state() reports armed after install', armed.armed === true)
ok('state() reports installed after install', armed.installed === true)

disarm()
const disarmed = fs.readFileSync(installedPath, 'utf8')
ok('disarm() blanks the token back out', /^\s*in:\s*\[""\]\s*$/m.test(disarmed))
ok('disarm() leaves the loop installed', state().installed === true)
ok('disarm() leaves it unarmed', state().armed === false)

// A different API base rewrites every occurrence of the default one.
const other = install('another-token', 'https://preview.example.com/')
ok('install() accepted a non-default API base', other.ok === true, other.error ?? '')
const rewritten = fs.readFileSync(installedPath, 'utf8')
ok('the non-default base replaced every default occurrence', !rewritten.includes('https://api.lyzn.ai'))
ok('the non-default base was written in, trailing slash trimmed', rewritten.includes('https://preview.example.com'))

console.log(failures === 0 ? '\nall ok (loops)' : `\n${failures} failure(s) (loops)`)
process.exit(failures === 0 ? 0 : 1)
