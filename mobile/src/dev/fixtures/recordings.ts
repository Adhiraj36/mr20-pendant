/**
 * The canvas' own day, as data.
 *
 * Three conversations — the quote review, the standup, the note to self —
 * with the transcript, summary and facts the design draws, plus the chats,
 * the memory hits and the categories the two Ask surfaces read. Everything a
 * screenshot pass needs and nothing it does not.
 *
 * The clock is today's, not the canvas' 4 September: the day grouping, the
 * `TUE 08 SEP · 3 CAPTURED` stamp and the "Today" heading are all functions
 * of `Date.now()`, and a fixture pinned to a date in the past would show a
 * screen nobody will ever see. The times of day are the canvas' own.
 */
import type {
  ChatSummary, Recording, Transcript, Utterance,
} from '../../api/client';
import type { MemoryHit } from '../../api/memory';
import type { FixtureTurn } from './index';

/** Today at `hh:mm`, local — the fixtures' only clock. */
function todayAt(hour: number, minute: number): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0).toISOString();
}

/** `{ speaker, start, end, text }` with the confidence a fixture cannot know. */
function line(speaker: number, start: number, end: number, text: string): Utterance {
  return { speaker, start, end, text, confidence: 0.94 };
}

export const QUOTE_REVIEW_ID = 'rec-quote-ravi';
export const STANDUP_ID = 'rec-standup-design';
export const NOTE_TO_SELF_ID = 'rec-note-to-self';

const base = {
  deviceMac: 'F0:13:D8:30:00:20',
  sizeBytes: 2_400_000,
  createdAt: todayAt(11, 27),
  updatedAt: todayAt(11, 29),
};

/**
 * H1's first row, C2's whole screen, C4's context. Telugu and English, two
 * speakers, two commitments, four facts, one already filed to memory.
 */
const quoteReview: Recording = {
  ...base,
  recordingId: QUOTE_REVIEW_ID,
  status: 'ready',
  deviceFolder: '20260908',
  deviceFile: '110400.wav',
  startedAt: todayAt(11, 4),
  durationSeconds: 22 * 60 + 11,
  cleanKey: `clean/${QUOTE_REVIEW_ID}.mp3`,
  title: 'Quote review with Ravi',
  tags: ['vendor', 'pricing'],
  summary:
    'Thickness spec moved 2.5 mm to 3 mm, so the old quote is void. '
    + 'The revised rate holds only above 1,000 units per batch. '
    + 'Delivery stays on the 12th if the batch is confirmed by Friday. '
    + 'Ravi wants the sample invoice on the new GST code.',
  actionItems: [
    { text: 'Send the revised quote to Ravi', owner: 1 },
    { text: 'Confirm the sample batch size', owner: 1 },
  ],
  speakers: { '0': 'Ravi', '1': 'You' },
  speakerCount: 2,
  categoryId: 'cat-work',
  memoryStatus: 'ingested',
  memoryIngestVersion: 1,
  facts: [
    { text: 'The enclosure thickness moved from 2.5 mm to 3 mm on 8 September.', kind: 'decision' },
    { text: 'Ravi runs the vendor side of the enclosure order.', kind: 'person' },
    { text: 'The revised rate only holds at 1,000 units or more per batch.', kind: 'fact' },
    { text: 'Ravi wants sample invoices raised on the new GST code.', kind: 'preference' },
  ],
};

const standup: Recording = {
  ...base,
  recordingId: STANDUP_ID,
  status: 'ready',
  deviceFolder: '20260908',
  deviceFile: '094100.wav',
  startedAt: todayAt(9, 41),
  durationSeconds: 8 * 60 + 4,
  sizeBytes: 900_000,
  title: 'Standup — design team',
  tags: ['design'],
  summary:
    'The STEP file goes to the Shenzhen vendor today. '
    + 'LED placement stays at the top edge, decided against the side. '
    + 'Priya owns the vendor follow-up from here.',
  actionItems: [{ text: 'Send pendant-v4.step to the vendor', owner: 0 }],
  speakers: { '0': 'You', '1': 'Priya' },
  speakerProfiles: {
    '0': { label: 'Designer', description: 'Likely the wearer; owns the STEP file and is sending it to the vendor today.' },
    '1': { label: 'Priya', description: 'Addressed as Priya; takes over the Shenzhen vendor follow-up.' },
  },
  speakerCount: 2,
  memoryStatus: 'ingested',
  memoryIngestVersion: 2,
  facts: [
    { text: 'The LED sits on the top edge of the pendant, not the side.', kind: 'decision' },
    { text: 'Priya owns vendor follow-up for the enclosure.', kind: 'person' },
  ],
};

const noteToSelf: Recording = {
  ...base,
  recordingId: NOTE_TO_SELF_ID,
  status: 'ready',
  deviceFolder: '20260908',
  deviceFile: '081500.wav',
  startedAt: todayAt(8, 15),
  durationSeconds: 3 * 60 + 12,
  sizeBytes: 320_000,
  title: 'Note to self',
  summary: 'CA filing deadline is the 15th. Insurance renewal is due the same week.',
  actionItems: [],
  speakers: { '0': 'You' },
  speakerCount: 1,
  memoryStatus: 'ingested',
  memoryIngestVersion: 1,
  facts: [
    { text: 'The CA filing deadline is the 15th of this month.', kind: 'fact' },
  ],
};

export const FIXTURE_RECORDINGS: Recording[] = [quoteReview, standup, noteToSelf];

// -- transcripts -----------------------------------------------------------

const quoteTranscript: Transcript = {
  recordingId: QUOTE_REVIEW_ID,
  language: 'te,en',
  model: 'nova-3',
  durationSeconds: quoteReview.durationSeconds,
  text: '',
  utterances: [
    line(0, 0, 34, 'Revised spec chusanu. Thickness maarindi kada?'),
    line(1, 34, 62, 'Yes — the enclosure went to three millimetres last week.'),
    line(0, 180, 214,
      'Thickness maarindi kabatti rate kuda maaraali. Old quote lo 2.5 mm undi.'),
    line(1, 240, 276,
      "Correct. I'll send you the revised quote before lunch. 3 mm rate lo."),
    line(0, 420, 468,
      'Sample batch ki minimum thousand units kavali, otherwise rate change avutundi.'),
    line(1, 600, 648,
      "Above a thousand units the revised rate holds. Below that we're back to the old sheet."),
    line(1, 900, 936, "I'll confirm the sample batch size by Friday."),
    line(0, 1080, 1122,
      'Delivery stays on the twelfth if the batch is confirmed by Friday.'),
    line(0, 1200, 1240, 'And put the sample invoice on the new GST code.'),
  ],
};
quoteTranscript.text = quoteTranscript.utterances.map((u) => u.text).join(' ');

const standupTranscript: Transcript = {
  recordingId: STANDUP_ID,
  language: 'en',
  model: 'nova-3',
  durationSeconds: standup.durationSeconds,
  text: '',
  utterances: [
    line(0, 0, 22, 'Send the STEP file today — the vendor is waiting on it.'),
    line(1, 22, 58, 'Top edge for the LED, then. The side reads like a status light on a router.'),
    line(0, 120, 156, "Agreed, top edge. I'll take the vendor follow-up unless Priya wants it."),
    line(1, 156, 180, "I'll take it."),
  ],
};
standupTranscript.text = standupTranscript.utterances.map((u) => u.text).join(' ');

const noteTranscript: Transcript = {
  recordingId: NOTE_TO_SELF_ID,
  language: 'en',
  model: 'nova-3',
  durationSeconds: noteToSelf.durationSeconds,
  text: '',
  utterances: [
    line(0, 0, 26, 'CA filing deadline is the fifteenth. Insurance renewal the same week.'),
  ],
};
noteTranscript.text = noteTranscript.utterances.map((u) => u.text).join(' ');

const TRANSCRIPTS: Record<string, Transcript> = {
  [QUOTE_REVIEW_ID]: quoteTranscript,
  [STANDUP_ID]: standupTranscript,
  [NOTE_TO_SELF_ID]: noteTranscript,
};

// -- the other reads the two Ask surfaces make -----------------------------

const CHATS: ChatSummary[] = [
  {
    id: 'chat-promised-ravi',
    title: 'What did I promise Ravi this week?',
    kind: 'text',
    exchanges: 2,
    createdAt: todayAt(12, 2),
    updatedAt: todayAt(12, 4),
  },
  {
    id: 'chat-still-open',
    title: 'Anything still open from Monday?',
    kind: 'text',
    exchanges: 1,
    createdAt: todayAt(9, 12),
    updatedAt: todayAt(9, 13),
  },
];

/**
 * What `GET /memory/search` answers. The paths carry the recording id, which
 * is what lets a hit become a citation chip the reader can actually open.
 */
const HITS: MemoryHit[] = [
  {
    path: `memories/${QUOTE_REVIEW_ID}/0001`,
    score: 0.91,
    snippet: 'Agreed to send the revised quote at the 3 mm rate before lunch.',
    when: todayAt(11, 8),
  },
  {
    path: `memories/${QUOTE_REVIEW_ID}/0002`,
    score: 0.84,
    snippet: 'The sample batch size is to be confirmed by Friday.',
    when: todayAt(11, 19),
  },
  {
    path: `memories/${STANDUP_ID}/0001`,
    score: 0.61,
    snippet: 'Priya owns the vendor follow-up for the enclosure.',
    when: todayAt(9, 44),
  },
];

// -- the resolvers --------------------------------------------------------

const AUDIO = {
  // A real, tiny, silent MP3 would need a file in the bundle; the player is
  // handed a URL that does not resolve, which is exactly what an expired
  // presign looks like. The transport is not what a screenshot is testing.
  url: 'https://fixtures.invalid/audio.mp3',
  expiresIn: 900,
  variant: 'enhanced' as const,
};

/** Splits `/recordings/rec-x/audio?raw=1` into its path and its query. */
function split(path: string): [string, string] {
  const at = path.indexOf('?');
  return at === -1 ? [path, ''] : [path.slice(0, at), path.slice(at + 1)];
}

export function recordingFixtures(method: string, rawPath: string, body?: unknown): unknown | undefined {
  const [path, query] = split(rawPath);

  if (method === 'GET' && path === '/recordings') {
    return { recordings: FIXTURE_RECORDINGS };
  }

  if (method === 'GET' && path === '/categories') {
    return { categories: [{ id: 'cat-work', name: 'Work' }, { id: 'cat-home', name: 'Home' }] };
  }

  if (method === 'GET' && path === '/chats') {
    return { chats: CHATS };
  }

  if (method === 'GET' && path === '/memory/search') {
    const q = new URLSearchParams(query).get('q')?.toLowerCase() ?? '';
    // A search that names nobody in the fixtures returns nothing, so the
    // "no citations" branch can be looked at too.
    const hits = q.includes('ravi') || q.includes('quote') || q.includes('promise')
      ? HITS
      : q.includes('led') || q.includes('vendor') || q.includes('priya')
        ? HITS.slice(2)
        : [];
    return { hits };
  }

  const detail = /^\/recordings\/([^/]+)$/.exec(path);
  if (detail) {
    const recording = FIXTURE_RECORDINGS.find((r) => r.recordingId === detail[1]);
    if (!recording) return undefined;
    if (method === 'GET') {
      return { recording, transcript: TRANSCRIPTS[recording.recordingId] ?? null };
    }
    if (method === 'PATCH') {
      // A rename re-files memory, which is what bumps the version — the one
      // thing the `REMEMBERED · v2` label is allowed to claim.
      const patch = (body ?? {}) as { speakers?: Record<string, string> };
      if (patch.speakers) {
        recording.speakers = patch.speakers;
        recording.memoryIngestVersion = Math.max(2, (recording.memoryIngestVersion ?? 1) + 1);
      }
      return recording;
    }
  }

  if (method === 'GET' && /^\/recordings\/[^/]+\/audio$/.test(path)) return AUDIO;

  return undefined;
}

// -- the answers Ask lyzn gives -------------------------------------------

const RAVI_ANSWER =
  'Two things. The revised quote at the 3 mm rate, before lunch on Tuesday — '
  + 'that one is sent. And a confirmed batch size by Friday, which is still open.';

const SCOPED_ANSWER =
  'You agreed to the 3 mm rate, not the old 2.5 mm quote — and only for batches '
  + 'of a thousand units or more. Nothing was settled on the GST code. '
  + 'You said it at 11:08, and the batch condition came back at 11:14.';

/**
 * A canned reply for whichever surface asked.
 *
 * The scoped sheet keys its conversation on the recording id (`ask-<id>`),
 * so the two are told apart by the id rather than by guessing at the words.
 */
export function askFixtures(conversationId: string, message: string): FixtureTurn | undefined {
  if (conversationId.startsWith('ask-')) {
    return { text: SCOPED_ANSWER, tools: [{ name: 'memory.recall', status: 'done', hits: 1 }] };
  }
  const asked = message.toLowerCase();
  if (asked.includes('open') || asked.includes('monday')) {
    return {
      text: 'One thing: the sample batch size for Ravi, due Friday. Everything else '
        + 'from Monday is either sent or dropped.',
      tools: [{ name: 'memory.recall', status: 'done', hits: 4 }],
    };
  }
  return { text: RAVI_ANSWER, tools: [{ name: 'memory.recall', status: 'done', hits: 6 }] };
}
