// Exercises stopTask's contract against fakes: kill the run first, tell LYZN
// second, and never guess at what happened when the two disagree about it.
//
// Run with `npm run test:stoptask`. Bundled the same way as loops.test.ts
// (see scripts/test-stoptask.mjs): electron aliased to the stub and
// KARMAX_DESKTOP_PROFILE pointed at a throwaway directory, because lyzn.ts
// still imports loops.js and config.js, which import electron — even though
// every dependency stopTask actually calls here is injected, never real.
import { stopTask } from '../electron/lyzn.js'
import type { ApiResult } from '../electron/shared/types.js'

let failures = 0
function ok(label: string, cond: boolean, extra = ''): void {
  if (!cond) failures++
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`)
}

// Never printed and never allowed to appear in anything stopTask hands back.
const TOKEN = 'lyzn-test-token-do-not-log'
const PAIRING = {
  token: TOKEN,
  daemonId: 'daemon_1',
  name: 'Test Laptop',
  api: 'https://api.lyzn.ai',
  pairedAt: '2026-01-01T00:00:00Z',
}

/** A fresh pair of fakes per test, recording what was called and in what
 *  order, with knobs for the failure shapes stopTask has to tell apart. */
function makeDeps(
  overrides: {
    toolReachable?: boolean
    toolSucceeded?: boolean
    wasRunning?: boolean
    resultOk?: boolean
    receipt?: { stamp?: string; quote?: string } | null
  } = {},
) {
  const calls: string[] = []
  const seen: Record<string, unknown> = {}

  const callTool = async <T = unknown>(name: string, args: unknown): Promise<ApiResult<T>> => {
    calls.push('tool')
    seen.toolName = name
    seen.toolArgs = args
    if (overrides.toolReachable === false) {
      return { ok: false, status: 0, data: null, error: 'could not reach the engine' } as ApiResult<T>
    }
    return {
      ok: true,
      status: 200,
      data: { ok: overrides.toolSucceeded !== false, output: { was_running: overrides.wasRunning ?? true } } as T,
      error: null,
    }
  }

  const request = async <T = unknown>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    token?: string,
  ): Promise<ApiResult<T>> => {
    calls.push('request')
    seen.method = method
    seen.path = path
    seen.body = body
    seen.token = token
    if (overrides.resultOk === false) {
      return { ok: false, status: 500, data: null, error: 'LYZN answered 500.' } as ApiResult<T>
    }
    const receipt = overrides.receipt === undefined ? { stamp: 'FAILED', quote: 'Stopped from the laptop.' } : overrides.receipt
    return { ok: true, status: 200, data: { task: { status: 'failed' }, receipt } as T, error: null }
  }

  return { calls, seen, callTool, request }
}

// Every result stopTask hands back, from every scenario below — checked once
// at the end for the one thing that must never be true of any of them: the
// token showing up in something a test (or a renderer) can read.
const allResults: unknown[] = []

// ---------------------------------------------------------------------------
// 1. The happy path: harness.stop before the result post, exact args, a
//    fresh close correctly read as not already finished.
{
  const { calls, seen, callTool, request } = makeDeps()
  const res = await stopTask('task-123', { callTool, request, pairing: () => PAIRING })
  allResults.push(res)

  ok('stop succeeds when the engine and LYZN both answer', res.ok === true, JSON.stringify(res))
  ok('harness.stop is called before the result post', calls.join(',') === 'tool,request')
  ok('the tool called is harness.stop', seen.toolName === 'harness.stop')
  ok(
    'the session key and workdir match the contract',
    JSON.stringify(seen.toolArgs) ===
      JSON.stringify({ session_id: 'lyzn:task-123', working_dir: 'lyzn-tasks/task-123' }),
  )
  ok('the result post hits the right task', seen.path === '/daemons/work/task-123/result')
  ok(
    'the result post reports failure with the stop summary',
    JSON.stringify(seen.body) === JSON.stringify({ outcome: 'failure', summary: 'Stopped from the laptop.' }),
  )
  ok('the result post carries the daemon token', seen.token === TOKEN)
  ok('wasRunning is read from the tool output', res.wasRunning === true)
  ok('a fresh close does not read as already finished', res.alreadyFinished === false)
}

// ---------------------------------------------------------------------------
// 2. Engine failure: the result endpoint must never be reached.
{
  const { calls, callTool, request } = makeDeps({ toolReachable: false })
  const res = await stopTask('task-123', { callTool, request, pairing: () => PAIRING })
  allResults.push(res)
  ok(
    'an unreachable engine gets the plain error',
    res.ok === false && res.error === "The engine isn't running. Start it and try again.",
  )
  ok('the result endpoint is never called', calls.join(',') === 'tool')
}
{
  const { calls, callTool, request } = makeDeps({ toolSucceeded: false })
  const res = await stopTask('task-123', { callTool, request, pairing: () => PAIRING })
  allResults.push(res)
  ok(
    'a tool-level error is treated the same as unreachable',
    res.ok === false && res.error === "The engine isn't running. Start it and try again.",
  )
  ok('the result endpoint is never called for a tool error either', calls.join(',') === 'tool')
}

// ---------------------------------------------------------------------------
// 3. Already finished: the receipt in the answer is not the one this call
//    would have printed, so it must have been someone else's.
{
  const { callTool, request } = makeDeps({ receipt: { stamp: 'DONE', quote: 'Something else finished it.' } })
  const res = await stopTask('task-123', { callTool, request, pairing: () => PAIRING })
  allResults.push(res)
  ok('a task closed by something else reads as already finished', res.ok === true && res.alreadyFinished === true)
}
{
  const { callTool, request } = makeDeps({ receipt: null })
  const res = await stopTask('task-123', { callTool, request, pairing: () => PAIRING })
  allResults.push(res)
  ok('no receipt at all also reads as already finished', res.ok === true && res.alreadyFinished === true)
}

// ---------------------------------------------------------------------------
// 4. A LYZN failure after a successful kill: stopped:true, safe to retry.
{
  const { calls, callTool, request } = makeDeps({ resultOk: false })
  const res = await stopTask('task-123', { callTool, request, pairing: () => PAIRING })
  allResults.push(res)
  ok('the kill is reported even though LYZN was not told', res.ok === false && res.stopped === true)
  ok('wasRunning still comes through', res.wasRunning === true)
  ok('the error names the fix', res.error === "Stopped here, but LYZN wasn't told. Try again.")
  ok('both calls were attempted', calls.join(',') === 'tool,request')
}

// ---------------------------------------------------------------------------
// 5. Rejected inputs make no calls at all.
for (const bad of ['', '../etc/passwd', 'has space', 'semi;colon', 'x'.repeat(129)]) {
  const { calls, callTool, request } = makeDeps()
  const res = await stopTask(bad, { callTool, request, pairing: () => PAIRING })
  allResults.push(res)
  ok(`invalid taskId ${JSON.stringify(bad)} is rejected`, res.ok === false && !!res.error)
  ok(`invalid taskId ${JSON.stringify(bad)} makes no calls`, calls.length === 0)
}
// Both shapes LYZN mints: "own_" + hex for tasks made in the app, and
// "<recordingId>-<n>" for tasks extracted from a recording.
for (const good of ['own_0123456789abcdef0123456789abcdef', '00000000-0000-4000-8000-000000000000-1']) {
  const { calls, callTool, request } = makeDeps()
  const res = await stopTask(good, { callTool, request, pairing: () => PAIRING })
  allResults.push(res)
  ok(`task id ${JSON.stringify(good)} is accepted`, res.ok === true)
  ok(`task id ${JSON.stringify(good)} reaches the engine, then LYZN`, calls.join(',') === 'tool,request')
}
{
  const { calls, callTool, request } = makeDeps()
  const res = await stopTask('task-123', { callTool, request, pairing: () => null })
  allResults.push(res)
  ok(
    'an unpaired machine gets the plain error',
    res.ok === false && res.error === 'This machine is not paired with LYZN yet.',
  )
  ok('an unpaired machine makes no calls', calls.length === 0)
}

// ---------------------------------------------------------------------------
// 6. The token never rides along in anything handed back.
for (const res of allResults) {
  ok('the daemon token never appears in a returned result', !JSON.stringify(res).includes(TOKEN))
}

console.log(failures === 0 ? '\nall ok (stoptask)' : `\n${failures} failure(s) (stoptask)`)
process.exit(failures === 0 ? 0 : 1)
