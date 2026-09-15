// Where the transcript looks while a reply is being written.
//
// Derived from what happened, never stored as a preference: a mode somebody
// has to choose is a mode somebody has to understand.
export type ScrollMode =
  /** A short reply grows and the view follows. */
  | 'following-end'
  /** The question pins near the top and the reply grows beneath it, so a long
   *  answer does not race past the thing that was asked. */
  | 'anchoring-new-turn'
  /** They scrolled. Nothing moves until they come back to the end. */
  | 'free-scrolling'

export type ScrollSignal =
  | { type: 'turn-started' }
  | { type: 'reached-end' }
  | { type: 'scrolled-away' }
  | { type: 'turn-settled' }

export const initialScroll: ScrollMode = 'following-end'

export function nextScroll(mode: ScrollMode, signal: ScrollSignal): ScrollMode {
  switch (signal.type) {
    case 'turn-started':
      return 'anchoring-new-turn'
    case 'scrolled-away':
      return 'free-scrolling'
    case 'reached-end':
      // Not while anchored: the reply is still growing under a question that
      // is meant to stay where it is.
      return mode === 'anchoring-new-turn' ? mode : 'following-end'
    case 'turn-settled':
      return mode === 'anchoring-new-turn' ? 'following-end' : mode
  }
}
