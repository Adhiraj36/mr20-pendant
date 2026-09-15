import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runTurn } from '../src/runTurn.ts'
import type { Adapter } from '../src/adapter.ts'
import type { TurnOptions } from '../src/types.ts'

// The model and effort picked in the composer must reach the transport, or
// the picker is decoration.
test('a turn hands its options to the adapter', async () => {
  let seen: TurnOptions | undefined
  const adapter: Adapter = {
    async send(_id, _text, onEvent, options) {
      seen = options
      onEvent({ kind: 'done', text: 'ok' })
    },
    stop() {},
    async list() { return [] },
    async history() { return [] },
  }
  const events: string[] = []
  await runTurn(adapter, null, 'hi', (e) => events.push(e.kind), () => true, { model: 'opus', effort: 'high' })
  assert.deepEqual(seen, { model: 'opus', effort: 'high' })
  assert.deepEqual(events, ['done'])
})

test('a turn without options sends none', async () => {
  let seen: TurnOptions | undefined = { model: 'x' }
  const adapter: Adapter = {
    async send(_id, _text, _onEvent, options) { seen = options },
    stop() {},
    async list() { return [] },
    async history() { return [] },
  }
  await runTurn(adapter, null, 'hi', () => {}, () => true)
  assert.equal(seen, undefined)
})
