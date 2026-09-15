/**
 * What a conversation says about itself — the models behind Home, the
 * conversation detail, the Ask sheet and the Ask lyzn tab.
 *
 * Everything here is a function of data the app actually holds. That is the
 * whole point of the file: the `REMEMBERED · n FACTS` card may not claim a
 * number the recording row does not carry, a citation chip may not name a
 * conversation this phone cannot open, and a summary is split into points
 * rather than being given a count somebody typed. Each of those is one
 * function with a test rather than a line of JSX nobody can check.
 *
 * No React, no react-native, no API client — `node --test` reaches it
 * directly (plan §1, "tests stay pure").
 */
import { joinLabel } from '../design/tokens';
import { conversationChips as kitChips, countLabel } from '../design/kit/models';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const pad = (n: number) => String(n).padStart(2, '0');

// -- Home's own line -------------------------------------------------------

/** `TUE 08 SEP` — the canvas' H1 stamp, day zero-padded as it draws it. */
export function homeStamp(date: Date = new Date()): string {
  if (Number.isNaN(date.getTime())) return '';
  return `${WEEKDAYS[date.getDay()]} ${pad(date.getDate())} ${MONTHS[date.getMonth()]}`;
}

/**
 * `TUE 08 SEP · 3 CAPTURED`, and `TUE 08 SEP · NOTHING YET` on the day
 * nothing has been (canvas H1 and S3, which differ only here).
 */
export function homeMeta(count: number, date: Date = new Date()): string {
  return joinLabel([homeStamp(date), count > 0 ? `${count} CAPTURED` : 'NOTHING YET']);
}

// -- the summary, as points ------------------------------------------------

/**
 * The summary split into the points the canvas numbers `01`, `02`, `03`.
 *
 * The enrichment pass returns one string, and C2 draws a numbered rail — so
 * the split has to happen somewhere, and a sentence is the only boundary the
 * text actually carries. Abbreviations that end in a period would each be
 * read as a sentence end, so a break only counts when what follows starts a
 * new sentence: whitespace, then a capital or a digit.
 *
 * A summary that is one long sentence stays one point. That is correct: the
 * card then says `SUMMARY · 1 KEY POINT`, which is true.
 */
export function summaryPoints(summary?: string): string[] {
  const text = (summary ?? '').trim();
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"'(])/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** `SUMMARY · 4 KEY POINTS`, or `SUMMARY` when there is one point. */
export function summaryHeading(points: number): string {
  return joinLabel(['SUMMARY', countLabel(points, 'KEY POINT')]);
}

// -- the commitments card --------------------------------------------------

/**
 * `2 COMMITMENTS FOUND · 1 STILL OPEN` — and, when every one is settled,
 * just `2 COMMITMENTS FOUND`, because "0 still open" is a fact stated as a
 * complaint. Nothing at all when there were none.
 */
export function commitmentsHeading(found: number, open: number): string | undefined {
  if (found <= 0) return undefined;
  const head = `${found} ${found === 1 ? 'COMMITMENT' : 'COMMITMENTS'} FOUND`;
  return open > 0 ? `${head} · ${open} STILL OPEN` : head;
}

// -- the remembered card ---------------------------------------------------

/** The shape the card reads. Structural, so a test needs no API object. */
export interface MemoryLike {
  facts?: { text: string; kind: string }[];
  memoryStatus?: 'ingested' | 'failed' | 'skipped';
  memoryIngestVersion?: number;
}

export interface FactsCard {
  /** `REMEMBERED · 4 FACTS`, or `FILED TO MEMORY` when there is no list. */
  heading: string;
  /** `MEMORY · v2`, only once a re-file has actually happened. */
  footer?: string;
  /** Whether there are facts to list under the heading. */
  hasFacts: boolean;
}

/**
 * What the `REMEMBERED` card may say — the one place in the app where
 * over-claiming would be a lie about the product's whole premise.
 *
 * Three honest states and no fourth:
 *
 * - facts on the row → `REMEMBERED · n FACTS`, and the n is the length of a
 *   list the reader can see;
 * - no facts but the ingest succeeded → `FILED TO MEMORY`, no count, because
 *   GitLoom's `Remember` returns nothing addressable and we do not know what
 *   it made of the dialogue (`[GL_FACT_IDS]`);
 * - anything else → no card. A failed or skipped ingest with nothing to show
 *   is not a memory, and drawing an empty card would imply one.
 *
 * The version footer only appears from v2 up: v1 is the ordinary first
 * filing and saying "v1" would invite the reader to wonder what v0 was.
 */
export function factsHeading(recording: MemoryLike): FactsCard | null {
  const facts = recording.facts ?? [];
  const version = recording.memoryIngestVersion ?? 0;
  const footer = version >= 2 ? `MEMORY · v${version}` : undefined;

  if (facts.length) {
    return {
      heading: joinLabel(['REMEMBERED', countLabel(facts.length, 'FACT')]),
      footer,
      hasFacts: true,
    };
  }
  if (recording.memoryStatus === 'ingested') {
    return { heading: 'FILED TO MEMORY', footer, hasFacts: false };
  }
  return null;
}

/** The eyebrow over one fact: what kind of thing it is. */
export function factKind(kind: string): string {
  switch (kind) {
    case 'preference': return 'PREFERENCE';
    case 'person': return 'PERSON';
    case 'decision': return 'DECISION';
    default: return 'FACT';
  }
}

// -- clocks ----------------------------------------------------------------

/**
 * `11:07` — where in the day a transcript line was said, not how far into
 * the file it is. The canvas' transcript column is a wall clock (C2), which
 * is what makes an answer's `↳ 11:08` chip point at something.
 */
export function wallClock(startedAt: string, offsetSeconds: number): string {
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) return '';
  const at = new Date(start.getTime() + Math.max(0, offsetSeconds) * 1000);
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** `11:04–11:26`, the span the detail's meta line opens with. */
export function clockSpan(startedAt: string, durationSeconds: number): string {
  const from = wallClock(startedAt, 0);
  if (!from) return '';
  const to = wallClock(startedAt, durationSeconds);
  return durationSeconds > 0 && to !== from ? `${from}–${to}` : from;
}

// -- languages -------------------------------------------------------------

/**
 * `TE + EN` from whatever Deepgram called the language.
 *
 * The field is one string and its shape is not guaranteed: `en`, `en-IN`,
 * `te,en`, `multi`. Regions are dropped, order is kept, and `multi` — which
 * says only that more than one was heard — produces nothing, because a chip
 * reading `MULTI` tells the reader less than no chip at all.
 */
export function languageChip(language?: string): string | undefined {
  if (!language) return undefined;
  const codes = language
    .split(/[,+\s]+/)
    .map((code) => code.split('-')[0].trim().toUpperCase())
    .filter((code) => /^[A-Z]{2,3}$/.test(code) && code !== 'MULTI');
  const seen = [...new Set(codes)];
  return seen.length ? seen.join(' + ') : undefined;
}

// -- a conversation row's chips -------------------------------------------

export interface RowChipInput {
  language?: string;
  commitments?: number;
  done?: number;
}

/**
 * The chips under a conversation row: the languages heard, how much was
 * promised, how much of it is settled.
 *
 * The counting and the joining are the kit's (`conversationChips` in
 * `design/kit/models.ts`); this is the recording-shaped door to it, so a
 * screen hands over a language string rather than assembling a list.
 */
export function conversationChips(input: RowChipInput) {
  const language = languageChip(input.language);
  return kitChips({
    languages: language ? [language] : [],
    commitments: input.commitments,
    done: input.done,
  });
}

// -- citations -------------------------------------------------------------

/** What `GET /memory/search` returns, structurally. */
export interface HitLike {
  path: string;
  snippet: string;
  when: string;
  score?: number;
}

/** What a citation needs to be openable. */
export interface CitedLike {
  recordingId: string;
  title?: string;
  startedAt: string;
}

export interface CitationChip {
  /** Stable across renders; a conversation can be cited twice at two times. */
  key: string;
  /** `QUOTE REVIEW · 11:08 ↗`. */
  label: string;
  recordingId: string;
  /** Seconds into the recording, when the hit's time lands inside it. */
  seconds?: number;
}

/** How much of a title a chip can carry before it stops being a chip. */
const TITLE_CHARS = 22;

/**
 * Memory hits, matched to the conversations this phone actually has.
 *
 * A hit carries a path and a snippet, not a recording id in a field — so the
 * match is a substring search for each known id across both. That is the
 * same evidence the backend's tombstone filter uses, and it has the same
 * property: a hit that names no conversation is dropped rather than guessed
 * at. An answer with no chips under it is an answer with no citations, which
 * is a true statement about what was found.
 *
 * Ordered by the hits' own order (the server's, by score), de-duplicated on
 * conversation *and* minute so one conversation can be cited at two moments
 * but never twice at the same one.
 */
export function citationChips(
  hits: HitLike[],
  recordings: CitedLike[],
  limit = 4,
): CitationChip[] {
  const chips: CitationChip[] = [];
  const seen = new Set<string>();

  for (const hit of hits) {
    const haystack = `${hit.path} ${hit.snippet}`;
    const found = recordings.find((r) => r.recordingId && haystack.includes(r.recordingId));
    if (!found) continue;

    const at = new Date(hit.when);
    const start = new Date(found.startedAt);
    const valid = !Number.isNaN(at.getTime()) && !Number.isNaN(start.getTime());
    const clock = valid ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : undefined;
    const offset = valid ? Math.round((at.getTime() - start.getTime()) / 1000) : -1;

    const key = `${found.recordingId}@${clock ?? '—'}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const title = (found.title || 'Conversation').trim();
    const short = title.length > TITLE_CHARS ? `${title.slice(0, TITLE_CHARS - 1).trimEnd()}…` : title;
    chips.push({
      key,
      label: `${joinLabel([short, clock])} ↗`,
      recordingId: found.recordingId,
      seconds: offset >= 0 ? offset : undefined,
    });
    if (chips.length >= limit) break;
  }

  return chips;
}

// -- an answer's own timestamps -------------------------------------------

export interface UtteranceLike {
  start: number;
  end: number;
}

export interface AnswerCitation {
  /** `↳ 11:08`. */
  label: string;
  /** Where to scroll the transcript to. */
  seconds: number;
  /** Which utterance that is. */
  utterance: number;
}

/** Any `h:mm` or `hh:mm` in running text. */
const CLOCK = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;

/**
 * The `↳ 11:08` chips under a scoped answer.
 *
 * The chips are not invented and they are not asked for: they are the times
 * the answer *itself* names, resolved against the transcript. A time that
 * does not land inside a line of this conversation produces no chip, so a
 * model that says "half past three" or misremembers a clock cannot make the
 * app draw a link to nowhere.
 */
export function answerCitations(
  text: string,
  startedAt: string,
  utterances: UtteranceLike[],
  limit = 4,
): AnswerCitation[] {
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime()) || !utterances.length) return [];

  const found: AnswerCitation[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(CLOCK)) {
    const label = `${pad(Number(match[1]))}:${match[2]}`;
    if (seen.has(label)) continue;

    // The clock as an offset into this recording, on the recording's own day.
    const at = new Date(start);
    at.setHours(Number(match[1]), Number(match[2]), 0, 0);
    const seconds = Math.round((at.getTime() - start.getTime()) / 1000);
    if (seconds < 0) continue;

    // A minute is 60 seconds wide and a line is not, so the chip points at
    // the line that was being spoken during that minute — the first one
    // that has not ended before it.
    const utterance = utterances.findIndex((u) => u.end > seconds && u.start < seconds + 60);
    if (utterance === -1) continue;

    seen.add(label);
    found.push({ label: `↳ ${label}`, seconds: utterances[utterance].start, utterance });
    if (found.length >= limit) break;
  }

  return found;
}
