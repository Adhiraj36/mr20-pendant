/**
 * How a question about one conversation is scoped.
 *
 * `POST /chat` has no per-recording filter — it takes a conversation id, a
 * message and a kind, and the wrapper's memory recall runs across the whole
 * namespace (`backend/go/internal/api/chat.go`). So the scope is built in
 * the message, and it is built here, where a test can read it:
 *
 * - the thread id is `ask-<recordingId>`, so a conversation's questions live
 *   in their own stored thread and re-opening the sheet resumes it;
 * - the **first** message carries the conversation itself and then the
 *   question. Later turns are the question alone, because the stored window
 *   already holds the context and re-sending a transcript every turn would
 *   be paid for every turn.
 *
 * That is a prompt, not an enforcement. The sheet's context strip says
 * "This conversation only", which is what the sheet is for and what the
 * preamble asks for — not a claim that an endpoint enforced it.
 */

/**
 * How much transcript the preamble may carry.
 *
 * `POST /chat` refuses a message over 8,000 characters and the preamble's
 * own head is a few hundred, so 5,000 leaves room for the question and for
 * a header that grew. A longer conversation is cut at a line boundary and
 * says so, rather than being cut mid-sentence and passing as whole.
 */
export const TRANSCRIPT_BUDGET = 5000;

/** The thread a conversation's questions live in. Stable, so it resumes. */
export function askThreadId(recordingId: string): string {
  return `ask-${recordingId}`;
}

/** Everything the preamble reads. Structural, so a test needs no API object. */
export interface AskContext {
  title?: string;
  when: string;
  speakers?: string[];
  summary?: string;
  commitments?: string[];
  /** `11:07 RAVI: …`, already clocked and named by the caller. */
  lines?: string[];
}

/**
 * The opening turn: the conversation, then the question.
 *
 * Everything in it is on the screen behind the sheet. Nothing is summarised
 * a second time and nothing is invented — which is also why the transcript
 * arrives as lines the detail screen already built rather than as raw
 * utterances this file would have to format a second way.
 */
export function askPreamble(context: AskContext, question: string): string {
  const lines: string[] = [];
  let used = 0;
  let truncated = false;

  for (const line of context.lines ?? []) {
    if (used + line.length > TRANSCRIPT_BUDGET) { truncated = true; break; }
    lines.push(line);
    used += line.length + 1;
  }

  return [
    'Here is one conversation of mine. Answer only from it.',
    '',
    `TITLE: ${context.title || 'Untitled conversation'}`,
    `WHEN: ${context.when}`,
    context.speakers?.length ? `SPEAKERS: ${context.speakers.join(', ')}` : undefined,
    context.summary ? `SUMMARY: ${context.summary}` : undefined,
    context.commitments?.length ? `COMMITMENTS: ${context.commitments.join('; ')}` : undefined,
    '',
    lines.length ? 'TRANSCRIPT (times are the clock on the day):' : 'NO TRANSCRIPT YET.',
    ...lines,
    truncated ? '[transcript continues beyond this point]' : undefined,
    '',
    'Answer from that conversation and nothing else. When you draw on a moment,',
    'give its time as hh:mm. If the answer is not in there, say it is not.',
    '',
    `QUESTION: ${question}`,
  ].filter((part): part is string => part !== undefined).join('\n');
}

/** Where the preamble ends and the question begins, for showing a turn back. */
const QUESTION_MARK = /^[\s\S]*\nQUESTION: /;

/**
 * A sent turn, as it should be read back.
 *
 * The preamble is *how* the question was asked, not what was asked; showing
 * it in the thread would bury three words under a transcript. A turn with no
 * preamble is returned unchanged.
 */
export function askQuestionOf(sent: string): string {
  return sent.replace(QUESTION_MARK, '');
}
