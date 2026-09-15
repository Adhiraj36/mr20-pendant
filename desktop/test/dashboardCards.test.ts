// Cards for dashboards an agent saved, drawn only from the tool's own answer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dashboardCards } from '../src/routes/chat/dashboardCards.js'

test('an engine agent’s direct save becomes a card', () => {
  const cards = dashboardCards([
    { id: '1', status: 'completed', input: { action: 'save', title: 'Preorders', html: '<lz-page></lz-page>' }, output: '{"id":"preorders","saved":true,"htmlVersion":1,"dataVersion":1}' },
  ])
  assert.deepEqual(cards, [{ kind: 'dashboard', id: 'preorders', title: 'Preorders', status: 'Saved', live: false }])
})

test('Claude Code’s karmax tool call becomes a card, title read from its --json', () => {
  const cards = dashboardCards([
    {
      id: '2',
      status: 'completed',
      kind: 'execute',
      input: { command: `karmax tool call dashboard --json '{"action":"save","title":"Reel comments","html":"<p>x</p>"}'` },
      output: 'ok\n{"output":{"id":"reel-comments","saved":true,"htmlVersion":2,"dataVersion":1}}',
    },
  ])
  assert.deepEqual(cards.map((c) => [c.id, c.title]), [['reel-comments', 'Reel comments']])
})

test('no card without proof: a failed call, a get, or another command', () => {
  assert.deepEqual(
    dashboardCards([
      { id: '3', status: 'failed', input: { action: 'save', title: 'X' }, output: '{"id":"x","saved":true}' },
      { id: '4', status: 'completed', input: { action: 'get', id: 'x' }, output: '{"dashboard":{"id":"x"}}' },
      { id: '5', status: 'completed', input: { command: 'echo dashboard saved' }, output: '{"id":"x","saved":true}' },
      { id: '6', status: 'completed', input: { command: "karmax tool call dashboard --json '{\"action\":\"save\"}'" }, output: 'error: html is required' },
    ]),
    [],
  )
})

test('saving the same dashboard twice in a turn is one card', () => {
  const call = (n: string) => ({ id: n, status: 'completed' as const, input: { action: 'save', title: 'Sales' }, output: '{"id":"sales","saved":true}' })
  assert.equal(dashboardCards([call('a'), call('b')]).length, 1)
})
