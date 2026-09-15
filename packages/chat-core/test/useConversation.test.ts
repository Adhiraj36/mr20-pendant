import { test } from 'node:test'
import assert from 'node:assert/strict'
import { empty, ask, reduce, rearm } from '../src/reduce.ts'
import { runTurn } from '../src/runTurn.ts'
import type { Adapter } from '../src/adapter.ts'
import type { TurnEvent } from '../src/types.ts'

// retry() must not re-ask: the user's bubble stays put, and only the failed
// reply is replaced.
test('rearm drops a failed reply and keeps exactly one user message', () => {
  let s = ask(empty(), 'archive them')
  s = reduce(s, { kind: 'error', text: 'the engine stopped' })
  s = rearm(s)

  const userMessages = s.messages.filter((m) => m.role === 'user')
  assert.equal(userMessages.length, 1)
  const last = s.messages.at(-1)!
  assert.equal(last.role, 'assistant')
  assert.equal(last.failed, undefined)
  assert.equal(last.streaming, true)
  assert.equal(last.text, '')
  assert.equal(s.busy, true)
})

// The turn guard is what lets switching conversations abandon a stale turn:
// once isCurrent goes false, no later event from that send may land.
test('a turn whose guard goes stale mid-stream stops applying events', async () => {
  let current = true
  const applied: TurnEvent[] = []
  const adapter: Adapter = {
    async send(_id, _text, onEvent) {
      onEvent({ kind: 'message', text: 'a' })
      current = false
      onEvent({ kind: 'message', text: 'b' })
      onEvent({ kind: 'done', text: 'a' })
    },
    stop() {},
    async list() { return [] },
    async history() { return [] },
  }

  await runTurn(adapter, null, 'go', (e) => applied.push(e), () => current)

  assert.deepEqual(applied, [{ kind: 'message', text: 'a' }])
})

// The path a real send takes end to end: ask() seeds the turn, runTurn feeds
// events through reduce in order, and exactly one reply lands.
test('events from a completed turn arrive in order and produce exactly one assistant reply', async () => {
  const adapter: Adapter = {
    async send(_id, _text, onEvent) {
      onEvent({ kind: 'conversation', id: 'sess-1' })
      onEvent({ kind: 'tool', tool: { id: 't1', title: 'Bash', kind: 'execute', status: 'in_progress' } })
      onEvent({ kind: 'message', text: 'Found 14.' })
      onEvent({ kind: 'tool_update', tool: { id: 't1', status: 'completed' } })
      onEvent({ kind: 'done', text: 'Found 14.' })
    },
    stop() {},
    async list() { return [] },
    async history() { return [] },
  }

  let s = ask(empty(), 'archive them')
  await runTurn(adapter, null, 'archive them', (e) => { s = reduce(s, e) }, () => true)

  assert.equal(s.conversationId, 'sess-1')
  assert.equal(s.busy, false)
  assert.equal(s.messages.at(-1)!.text, 'Found 14.')
  // tool_update merges by id: the title from the announcement survives, and
  // the completed status lands on the same call rather than a second one.
  assert.deepEqual(s.messages.at(-1)!.toolCalls, [{ id: 't1', title: 'Bash', kind: 'execute', status: 'completed' }])
  assert.equal(s.messages.filter((m) => m.role === 'assistant').length, 1)
})
