import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialScroll, nextScroll } from '../src/scroll.ts'
import type { ScrollMode } from '../src/scroll.ts'

test('a conversation opens following the end', () => {
  assert.equal(initialScroll, 'following-end')
})

// The point of the whole machine: the question you just asked stays put.
test('starting a turn anchors the new question', () => {
  assert.equal(nextScroll('following-end', { type: 'turn-started' }), 'anchoring-new-turn')
  assert.equal(nextScroll('free-scrolling', { type: 'turn-started' }), 'anchoring-new-turn')
})

// Yanking the view back while somebody is reading further up is the rudest
// thing a chat can do.
test('scrolling away frees the view from every mode', () => {
  const modes: ScrollMode[] = ['following-end', 'anchoring-new-turn', 'free-scrolling']
  for (const m of modes) {
    assert.equal(nextScroll(m, { type: 'scrolled-away' }), 'free-scrolling', m)
  }
})

test('returning to the end resumes following', () => {
  assert.equal(nextScroll('free-scrolling', { type: 'reached-end' }), 'following-end')
})

// Reaching the end mid-reply must not break the anchor: the reply is still
// growing and the question should stay where it is.
test('reaching the end while anchored keeps the anchor', () => {
  assert.equal(nextScroll('anchoring-new-turn', { type: 'reached-end' }), 'anchoring-new-turn')
})

test('a settled turn releases the anchor', () => {
  assert.equal(nextScroll('anchoring-new-turn', { type: 'turn-settled' }), 'following-end')
  assert.equal(nextScroll('free-scrolling', { type: 'turn-settled' }), 'free-scrolling')
})

// Edge case: if following-end and reached-end again, stay following.
test('reached-end while already following is idempotent', () => {
  assert.equal(nextScroll('following-end', { type: 'reached-end' }), 'following-end')
})

// Edge case: if following-end when a turn settles, stay following.
test('turn-settled while following is idempotent', () => {
  assert.equal(nextScroll('following-end', { type: 'turn-settled' }), 'following-end')
})

// Edge case: if anchoring when a new turn starts (shouldn't happen, but the
// machine handles it: stay anchored).
test('turn-started while anchored stays anchored', () => {
  assert.equal(nextScroll('anchoring-new-turn', { type: 'turn-started' }), 'anchoring-new-turn')
})
