/**
 * `[ACTION_SOURCE]` (app spec §0.3, §2.7 step 5) — the best-effort match from
 * an action item back to the utterance it came from. The threshold is the
 * whole point: a wrong line swept is worse than no line at all, so the cases
 * that must return `null` are as load-bearing as the ones that must match.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contentWords, matchActionSource, MATCH_THRESHOLD, words,
} from '../../src/recordings/actionSource';

test('words carry their positions, lowercased', () => {
  assert.deepEqual(words("Send Ravi's invoice"), [
    { word: 'send', start: 0, end: 4 },
    { word: "ravi's", start: 5, end: 11 },
    { word: 'invoice', start: 12, end: 19 },
  ]);
});

test('content words drop the stop-words and the one-letter tokens', () => {
  assert.deepEqual(
    contentWords('Send the invoice to Ravi by Friday').sort(),
    ['friday', 'invoice', 'ravi', 'send'].sort(),
  );
  // Deduplicated: a repeated word is one word to cover.
  assert.deepEqual(contentWords('Invoice the invoice'), ['invoice']);
  assert.deepEqual(contentWords('to the and of'), []);
});

test('the threshold is half the item s content words', () => {
  assert.equal(MATCH_THRESHOLD, 0.5);
});

test('matches the utterance with the highest overlap and spans the matched words', () => {
  const utterances = [
    { text: 'Morning everyone, how was the weekend?' },
    { text: 'Can you send the invoice to Ravi before Friday please.' },
    { text: 'I will look at the numbers later.' },
  ];
  const match = matchActionSource('Send the invoice to Ravi by Friday', utterances);
  assert.ok(match);
  assert.equal(match.utterance, 1);
  // From "send" to "friday", the first and last words that matched.
  assert.equal(utterances[1].text.slice(match.from, match.to), 'send the invoice to Ravi before Friday');
  assert.ok(match.coverage >= MATCH_THRESHOLD);
});

test('no utterance covering half the item is no match, and so no sweep', () => {
  const utterances = [
    { text: 'We talked about the invoice for a while.' },
    { text: 'Nothing else came up.' },
  ];
  // Only "invoice" of {send, invoice, ravi, friday, quarterly} — 20%.
  assert.equal(matchActionSource('Send Ravi the quarterly invoice by Friday', utterances), null);
});

test('an item with no content words never matches', () => {
  assert.equal(matchActionSource('to the and of', [{ text: 'to the and of' }]), null);
});

test('an empty transcript is not a match', () => {
  assert.equal(matchActionSource('Send the invoice', []), null);
});

test('a repeated phrase matches the first time it was said', () => {
  const utterances = [
    { text: 'Book the meeting room for Thursday.' },
    { text: 'Book the meeting room for Thursday.' },
  ];
  const match = matchActionSource('Book the meeting room Thursday', utterances);
  assert.ok(match);
  assert.equal(match.utterance, 0);
});

test('coverage counts distinct item words, not repeats', () => {
  // "invoice" four times is still one of the item's four content words.
  const utterances = [{ text: 'Invoice, invoice, invoice, invoice.' }];
  assert.equal(matchActionSource('Send Ravi the invoice Friday', utterances), null);
});
