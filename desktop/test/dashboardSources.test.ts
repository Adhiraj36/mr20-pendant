// The id, data-name and live-source rules a dashboard's data channel enforces
// before anything reaches the network — including the one that matters most:
// a page can only read the live sources its own agent declared.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isLiveSource,
  isRemovableId,
  isValidId,
  LIVE_SOURCES,
  liveSourceAllowed,
  parseSource,
} from '../electron/dashboardSources.js'

test('ids: the default id and the engine\'s slug shape, nothing else', () => {
  assert.equal(isValidId('_default'), true)
  assert.equal(isValidId('sales-2026'), true)
  assert.equal(isValidId('Sales'), false)
  assert.equal(isValidId('_kit'), false)
  assert.equal(isValidId(''), false)
  assert.equal(isValidId('../etc'), false)
})

test('the default dashboard cannot be removed; a real one can', () => {
  assert.equal(isRemovableId('_default'), false)
  assert.equal(isRemovableId('sales-2026'), true)
  assert.equal(isRemovableId('not valid!'), false)
})

test('a plain name is a data file, live: is a live source, anything else is refused', () => {
  assert.deepEqual(parseSource('orders'), { kind: 'data', name: 'orders' })
  assert.deepEqual(parseSource('live:activity'), { kind: 'live', name: 'activity' })
  assert.equal(parseSource('live:'), null)
  assert.equal(parseSource('Orders'), null)
  assert.equal(parseSource('../etc/passwd'), null)
  assert.equal(parseSource('orders/../secret'), null)
})

test('the live allowlist is exactly the fixed set the main process can reach', () => {
  assert.deepEqual(
    [...LIVE_SOURCES].sort(),
    ['activity', 'brain', 'engine', 'logs', 'loop-health', 'loops', 'memory', 'notifications', 'tasks'].sort(),
  )
  assert.equal(isLiveSource('brain'), true)
  assert.equal(isLiveSource('shell'), false)
})

test('_default may read every live source; another dashboard only what it declared', () => {
  assert.equal(liveSourceAllowed('_default', 'brain', []), true)
  assert.equal(liveSourceAllowed('sales-2026', 'brain', []), false)
  assert.equal(liveSourceAllowed('sales-2026', 'brain', ['brain']), true)
  // Declaring a name that was never a real live source declares nothing.
  assert.equal(liveSourceAllowed('sales-2026', 'not-a-source', ['not-a-source']), false)
})
