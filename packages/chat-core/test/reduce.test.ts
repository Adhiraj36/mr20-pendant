import { test } from 'node:test'
import assert from 'node:assert/strict'
import { empty, ask, reduce } from '../src/reduce.ts'

// Deltas accumulate into one reply rather than one bubble each.
test('message deltas accumulate', () => {
  let s = ask(empty(), 'hello')
  s = reduce(s, { kind: 'message', text: 'Found ' })
  s = reduce(s, { kind: 'message', text: '14.' })
  const last = s.messages.at(-1)!
  assert.equal(last.role, 'assistant')
  assert.equal(last.text, 'Found 14.')
  assert.equal(last.streaming, true)
})

// Reasoning is a separate stream and must never land in the reply.
test('thought deltas accumulate apart from the reply', () => {
  let s = ask(empty(), 'hello')
  s = reduce(s, { kind: 'thought', text: 'Let me ' })
  s = reduce(s, { kind: 'message', text: 'Yes.' })
  s = reduce(s, { kind: 'thought', text: 'check.' })
  const last = s.messages.at(-1)!
  assert.equal(last.thought, 'Let me check.')
  assert.equal(last.text, 'Yes.')
})

// The whole reason for the id: resolving by name resolved the wrong call.
test('a tool update resolves its own call, not the most recent one', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'tool', tool: { id: 'a', title: 'one.go', kind: 'read', status: 'in_progress' } })
  s = reduce(s, { kind: 'tool', tool: { id: 'b', title: 'two.go', kind: 'read', status: 'in_progress' } })
  s = reduce(s, { kind: 'tool_update', tool: { id: 'a', status: 'completed', output: 'package one' } })

  const calls = s.messages.at(-1)!.toolCalls
  assert.equal(calls.length, 2)
  assert.equal(calls[0].status, 'completed')
  assert.equal(calls[0].output, 'package one')
  assert.equal(calls[0].title, 'one.go', 'the update must not erase the title')
  assert.equal(calls[1].status, 'in_progress')
})

// TodoWrite's own tool_result has an id nobody announced.
test('an update for an unknown call is dropped', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'tool_update', tool: { id: 'ghost', status: 'completed' } })
  assert.deepEqual(s.messages.at(-1)!.toolCalls, [])
})

// The agent revises its plan wholesale; merging would invent a history.
test('a plan replaces the previous plan', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'plan', plan: [{ content: 'one', status: 'pending' }] })
  s = reduce(s, {
    kind: 'plan',
    plan: [{ content: 'one', status: 'completed' }, { content: 'two', status: 'in_progress' }],
  })
  const plan = s.messages.at(-1)!.plan
  assert.equal(plan.length, 2)
  assert.equal(plan[0].status, 'completed')
})

test('meta lands on the reply', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'meta', model: 'claude-opus-5', durationMs: 7830, costUsd: 0.012 })
  assert.equal(s.messages.at(-1)!.meta?.model, 'claude-opus-5')
  assert.equal(s.messages.at(-1)!.meta?.durationMs, 7830)
})

test('a ticket becomes a card', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'ticket', jobId: 'j1', title: 'Nightly report' })
  assert.deepEqual(s.messages.at(-1)!.cards, [
    { kind: 'ticket', id: 'j1', title: 'Nightly report', status: 'Running', live: true },
  ])
})

// The turn's own answer wins over the deltas: a partial stream can be truncated.
test('done settles the reply with the engine text', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'message', text: 'partial' })
  s = reduce(s, { kind: 'done', text: 'the whole answer' })
  assert.equal(s.messages.at(-1)!.text, 'the whole answer')
  assert.equal(s.messages.at(-1)!.streaming, false)
  assert.equal(s.busy, false)
})

test('error marks the reply failed and frees the composer', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'error', text: 'nope' })
  assert.equal(s.messages.at(-1)!.failed, true)
  assert.equal(s.busy, false)
})

test('conversation id is remembered', () => {
  const s = reduce(empty(), { kind: 'conversation', id: 'c1' })
  assert.equal(s.conversationId, 'c1')
})

// The CLI streams each text block on its own, with nothing between them.
test('prose either side of a tool call is two paragraphs', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'message', text: 'Let me check.' })
  s = reduce(s, { kind: 'tool', tool: { id: 'a', title: 'ls', kind: 'execute', status: 'in_progress' } })
  s = reduce(s, { kind: 'tool_update', tool: { id: 'a', status: 'completed' } })
  s = reduce(s, { kind: 'message', text: '## Found ' })
  s = reduce(s, { kind: 'message', text: 'it' })
  assert.equal(s.messages.at(-1)!.text, 'Let me check.\n\n## Found it')
})

test('work before any words opens no blank paragraph', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'tool', tool: { id: 'a', title: 'ls', kind: 'execute', status: 'in_progress' } })
  s = reduce(s, { kind: 'message', text: 'Done.' })
  assert.equal(s.messages.at(-1)!.text, 'Done.')
})

// done carries the last block only: it must not erase the narration before it.
test('done keeps the narration when the stream already ends with the answer', () => {
  let s = ask(empty(), 'go')
  s = reduce(s, { kind: 'message', text: 'Let me check.' })
  s = reduce(s, { kind: 'tool', tool: { id: 'a', title: 'ls', kind: 'execute', status: 'in_progress' } })
  s = reduce(s, { kind: 'message', text: 'Found 14.' })
  s = reduce(s, { kind: 'done', text: 'Found 14.' })
  assert.equal(s.messages.at(-1)!.text, 'Let me check.\n\nFound 14.')
  assert.equal(s.messages.at(-1)!.textBreak, undefined)
})
