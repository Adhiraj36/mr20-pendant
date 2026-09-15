/**
 * The Library's day grouping and its mono labels (app spec §2.6).
 *
 * The headings and the meta lines are literal copy in the spec, so they are
 * pinned here rather than described. Dates are built from local components
 * on purpose — the grouping is by *local* day, and a UTC literal would make
 * these assertions depend on where the machine is.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayHeading, dayKey, detailMeta, filedRowMeta, formatDayStamp, formatSpan,
  formatTimeOfDay, groupByDay, libraryEyebrow, libraryStats,
} from '../../src/recordings/grouping';
import type { RecordingStatus } from '../../src/api/client';

/** A local instant, as the API would have serialised it. */
const at = (y: number, m: number, d: number, h = 9, min = 41) =>
  new Date(y, m - 1, d, h, min).toISOString();

const record = (
  id: string,
  startedAt: string,
  durationSeconds = 720,
  status: RecordingStatus = 'ready',
) => ({ recordingId: id, status, startedAt, durationSeconds });

const NOW = new Date(2026, 8, 7, 12, 0); // 7 Sep 2026, local

test('formatSpan is coarse: hours and minutes, or seconds alone', () => {
  assert.equal(formatSpan(3864), '1H 04M');
  assert.equal(formatSpan(720), '12M');
  assert.equal(formatSpan(2880), '48M');
  assert.equal(formatSpan(48), '48S');
  assert.equal(formatSpan(0), '0S');
  assert.equal(formatSpan(-5), '0S');
});

test('formatTimeOfDay is a local 24 hour clock, zero padded', () => {
  assert.equal(formatTimeOfDay(at(2026, 9, 7, 9, 41)), '09:41');
  assert.equal(formatTimeOfDay(at(2026, 9, 7, 21, 4)), '21:04');
  assert.equal(formatTimeOfDay('not a date'), '');
});

test('dayKey is the local calendar day', () => {
  assert.equal(dayKey(at(2026, 9, 7, 23, 30)), '2026-09-07');
  assert.equal(dayKey(at(2026, 1, 1, 0, 5)), '2026-01-01');
});

test('dayHeading: today, yesterday, a weekday within six days, then a date', () => {
  assert.equal(dayHeading(at(2026, 9, 7), NOW), 'Today');
  assert.equal(dayHeading(at(2026, 9, 6), NOW), 'Yesterday');
  // 3 Sep 2026 is a Thursday — the spec's own example.
  assert.equal(dayHeading(at(2026, 9, 3), NOW), 'Thursday');
  // Six days back is still a weekday; the seventh is a date.
  assert.equal(dayHeading(at(2026, 9, 1), NOW), 'Tuesday');
  assert.equal(dayHeading(at(2026, 8, 31), NOW), '31 Aug');
  // Across a year boundary the year is spelled out.
  assert.equal(dayHeading(at(2025, 9, 4), NOW), '4 Sep 2025');
});

test('formatDayStamp is the detail header s date', () => {
  assert.equal(formatDayStamp(at(2026, 9, 3)), 'Thu 3 Sep');
});

test('groupByDay: newest day first, newest row first, with its own meta', () => {
  const groups = groupByDay(
    [
      record('a', at(2026, 9, 6, 9, 0), 1200),
      record('b', at(2026, 9, 7, 9, 0), 1200),
      record('c', at(2026, 9, 7, 18, 0), 1680),
    ],
    NOW,
  );

  assert.deepEqual(groups.map((g) => g.key), ['2026-09-07', '2026-09-06']);
  assert.deepEqual(groups.map((g) => g.heading), ['Today', 'Yesterday']);
  // Newest first inside the day: 18:00 before 09:00.
  assert.deepEqual(groups[0].items.map((r) => r.recordingId), ['c', 'b']);
  assert.equal(groups[0].meta, '2 CONVERSATIONS · 48M');
  assert.equal(groups[1].meta, '1 CONVERSATION · 20M');
});

test('groupByDay: a day whose rows have no length yet drops the span', () => {
  const [group] = groupByDay([record('a', at(2026, 9, 7), 0, 'processing')], NOW);
  assert.equal(group.meta, '1 CONVERSATION');
});

test('libraryStats counts the live rows and the transcribed seconds only', () => {
  const stats = libraryStats([
    record('a', at(2026, 9, 7), 600, 'ready'),
    record('b', at(2026, 9, 7), 300, 'processing'),
    record('c', at(2026, 9, 7), 900, 'archived'),
    record('d', at(2026, 9, 7), 120, 'uploaded'),
  ]);
  assert.deepEqual(stats, { count: 3, seconds: 600, working: 2 });
});

test('libraryEyebrow drops every fragment that has nothing behind it', () => {
  assert.equal(
    libraryEyebrow({ count: 42, seconds: 3864, working: 3 }),
    'LIBRARY · 42 CONVERSATIONS · 1H 04M TRANSCRIBED · 3 TRANSCRIBING',
  );
  assert.equal(
    libraryEyebrow({ count: 1, seconds: 720, working: 0 }),
    'LIBRARY · 1 CONVERSATION · 12M TRANSCRIBED',
  );
  assert.equal(libraryEyebrow({ count: 0, seconds: 0, working: 0 }), 'LIBRARY');
});

test('filedRowMeta prints only what the API actually returned', () => {
  assert.equal(
    filedRowMeta({
      startedAt: at(2026, 9, 7, 9, 41),
      durationSeconds: 720,
      speakerCount: 2,
      status: 'ready',
      actionItems: [{ text: 'a', owner: null }, { text: 'b', owner: 1 }],
    }, 'Work'),
    '09:41 · 12M · 2 SPEAKERS · WORK · 2 TASKS',
  );

  assert.equal(
    filedRowMeta({
      startedAt: at(2026, 9, 7, 9, 41),
      durationSeconds: 0,
      status: 'pending',
    }),
    '09:41',
  );

  assert.equal(
    filedRowMeta({
      startedAt: at(2026, 9, 7, 9, 41),
      durationSeconds: 30,
      status: 'archived',
    }),
    '09:41 · 30S · NO SPEECH · GONE IN 30 DAYS',
  );
});

test('detailMeta leads with the date stamp and takes the length from the player', () => {
  assert.equal(
    detailMeta({ startedAt: at(2026, 9, 3, 9, 41), speakerCount: 2 }, 720),
    'THU 3 SEP · 09:41 · 12M · 2 SPEAKERS',
  );
  assert.equal(
    detailMeta({ startedAt: at(2026, 9, 3, 9, 41) }, 0),
    'THU 3 SEP · 09:41',
  );
});
