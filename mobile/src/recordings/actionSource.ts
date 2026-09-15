/**
 * `[ACTION_SOURCE]` — app spec §0.3 and §2.7 step 5.
 *
 * Action items carry no reference to the utterance they came from, so this
 * is the spec's stated fallback and nothing more: tokenise the item, drop
 * stop-words, and take the utterance with the highest content-word overlap
 * **if** it covers at least half of the item's content words. No match means
 * no sweep — a wrong line highlighted is worse than none.
 *
 * Pure: no React, no react-native, no API. The screen turns a match into the
 * scroll and the sweep (M4); this file only decides what matched, and where.
 */

/**
 * Words carrying no evidence. Deliberately small: an action item is a short
 * imperative ("Send Ravi the invoice by Friday"), so an aggressive list would
 * leave two words to match on and the 0.5 threshold would mean nothing.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'did',
  'do', 'does', 'for', 'from', 'get', 'go', 'had', 'has', 'have', 'he', 'her',
  'him', 'his', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'not', 'of',
  'on', 'or', 'our', 'out', 'she', 'so', 'that', 'the', 'their', 'them',
  'then', 'there', 'they', 'this', 'to', 'up', 'us', 'was', 'we', 'were',
  'will', 'with', 'would', 'you', 'your',
]);

/** Letters and digits only; apostrophes inside a word are kept together. */
const WORD = /[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu;

export interface WordSpan {
  word: string;
  /** Character offsets into the text this word came from. */
  start: number;
  end: number;
}

export interface ActionMatch {
  /** Index into the utterance list. */
  utterance: number;
  /** Character offsets spanning the first to the last matched word. */
  from: number;
  to: number;
  /** Fraction of the item's content words this utterance covers, 0..1. */
  coverage: number;
}

/** The minimum coverage the spec asks for before a sweep is drawn. */
export const MATCH_THRESHOLD = 0.5;

/** Every word in `text` with its position, lowercased for comparison. */
export function words(text: string): WordSpan[] {
  const found: WordSpan[] = [];
  for (const m of text.matchAll(WORD)) {
    found.push({ word: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  }
  return found;
}

/** The content words of an item: lowercased, stop-words dropped, deduplicated. */
export function contentWords(text: string): string[] {
  const seen = new Set<string>();
  for (const { word } of words(text)) {
    if (word.length < 2 || STOP_WORDS.has(word)) continue;
    seen.add(word);
  }
  return [...seen];
}

/**
 * The utterance an action item most likely came from, or `null`.
 *
 * Ties go to the earliest utterance: when a phrase is repeated, the first
 * time it was said is the one the item was drawn from.
 */
export function matchActionSource(
  itemText: string,
  utterances: { text: string }[],
): ActionMatch | null {
  const wanted = contentWords(itemText);
  if (!wanted.length) return null;
  const wantedSet = new Set(wanted);

  let best: ActionMatch | null = null;

  utterances.forEach((utterance, index) => {
    const spans = words(utterance.text);
    const hits = spans.filter((span) => wantedSet.has(span.word));
    if (!hits.length) return;

    // Coverage counts distinct item words, not repeats: an utterance that
    // says "invoice" four times has not matched four of the item's words.
    const covered = new Set(hits.map((h) => h.word)).size;
    const coverage = covered / wanted.length;
    if (coverage < MATCH_THRESHOLD) return;
    if (best && coverage <= best.coverage) return;

    best = {
      utterance: index,
      from: hits[0].start,
      to: hits[hits.length - 1].end,
      coverage,
    };
  });

  return best;
}
