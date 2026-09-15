/**
 * What memory actually holds — not how many recordings exist.
 *
 * The two are different numbers and the difference matters: a conversation
 * is only *remembered* once its transcript has been filed, which happens a
 * minute or two after it is captured and which failed outright for every
 * recording until the namespace was fixed. Counting recordings here would
 * promise a memory that is not there yet, and the honest thing when nothing
 * has been filed is to say so rather than print a zero.
 */
export function rememberedLabel(recordings: { memoryStatus?: string }[]): string {
  const filed = recordings.filter((r) => r.memoryStatus === 'ingested').length;
  if (filed > 0) return `${filed} ${filed === 1 ? 'CONVERSATION' : 'CONVERSATIONS'} REMEMBERED`;
  const waiting = recordings.filter((r) => r.memoryStatus === undefined || r.memoryStatus === 'pending').length;
  if (waiting > 0) return 'FILING WHAT YOU SAID';
  if (recordings.length > 0) return 'NOTHING FILED TO MEMORY YET';
  return 'NOTHING RECORDED YET';
}

