// What Claude Code writes into a transcript that was never said to Mira.
//
// The engine lists the sessions Claude Code already keeps, and those carry the
// CLI's own furniture: a skill's whole instructions pasted in as a user turn,
// a `/clear` wrapped in XML, a caveat about local commands used as a title.
// None of it is what the person typed, so none of it is drawn as though it
// were. Kept apart from the components so the rules are testable with no DOM.

/** Nerd Font glyphs live in the private-use planes. Pasted terminal output is
 *  full of them, and without that font each one is a box. */
const GLYPHS = /[\u{E000}-\u{F8FF}]|[\u{F0000}-\u{FFFFD}]|[\u{100000}-\u{10FFFD}]/gu

export function stripGlyphs(s: string): string {
  return s.replace(GLYPHS, '')
}

/** A user turn the CLI wrote rather than the person. */
export type Injected =
  | { kind: 'skill'; name: string }
  | { kind: 'command'; name: string }
  /** The brief the engine hands Claude Code for a task: memory, tools, the
   *  task itself. Written by the engine, never by the person. */
  | { kind: 'brief' }
  /** Caveats, command stdout, reminders: nothing worth a line of its own. */
  | { kind: 'silent' }

export function injected(text: string): Injected | null {
  const t = text.trimStart()
  const skill = /^Base directory for this skill:\s*(\S+)/.exec(t)
  if (skill) {
    const name = skill[1].split('/').filter(Boolean).at(-1)
    return { kind: 'skill', name: name ?? 'a skill' }
  }
  if (/^# KARMAX context \(auto-injected\)/.test(t) || /^The person wearing a LYZN pendant promised/.test(t)) {
    return { kind: 'brief' }
  }
  const command = /<command-name>\s*([^<]+?)\s*<\/command-name>/.exec(t)
  if (command) return { kind: 'command', name: command[1] }
  if (/^<(local-command-caveat|local-command-stdout|local-command-stderr|system-reminder|command-message)>/.test(t)) {
    return { kind: 'silent' }
  }
  return null
}

/** A conversation's name, from the AI title or else the first thing asked.
 *
 *  A candidate that is only CLI furniture is skipped rather than cleaned into
 *  a plausible-looking fragment of the caveat text. */
export function conversationTitle(c: { title?: string; opening?: string }): string {
  for (const raw of [c.title, c.opening]) {
    if (!raw || injected(raw)) continue
    const s = stripGlyphs(raw.replace(/<\/?[a-z][a-z-]*>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim()
    if (s) return s
  }
  return 'Untitled conversation'
}

/** Pasted terminal output: box drawing, or lines padded out to a prompt's
 *  right-hand side. Set in mono so its columns survive. */
export function looksLikeTerminal(text: string): boolean {
  return /[╭╮╰╯│─]/.test(text) || / {12,}\S/.test(text)
}

/** The padding a prompt theme adds to reach the right edge of a terminal is
 *  meaningless in a narrower column, and wraps into blank lines. */
export function squeezeTerminal(text: string): string {
  return stripGlyphs(text).replace(/ {6,}/g, '  ').replace(/[ \t]+$/gm, '')
}

export type DayGroup = 'Today' | 'Yesterday' | 'This week' | 'Earlier'

/** Which heading a conversation sits under in the list. */
export function dayGroup(iso: string, now = new Date()): DayGroup {
  const then = new Date(iso)
  if (!Number.isFinite(then.getTime())) return 'Earlier'
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 86_400_000
  if (then.getTime() >= start) return 'Today'
  if (then.getTime() >= start - day) return 'Yesterday'
  if (then.getTime() >= start - 6 * day) return 'This week'
  return 'Earlier'
}

/** "4m", "3h", "2d" — the list's right-hand column has room for no more. */
export function shortAgo(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  // Floored, so a conversation under "Yesterday" never reads "2d".
  const mins = Math.max(0, Math.floor((now - then) / 60_000))
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(then).toLocaleDateString([], { day: 'numeric', month: 'short' })
}

/** An older engine joined a turn's prose blocks with nothing between them, so
 *  "Let me check." and "## Root cause" were stored as "Let me check.## Root
 *  cause". This splits where a sentence ends hard against a capital, a
 *  heading, bold or code — never inside code, where `os.Exit` is not two
 *  sentences. */
export function unglue(text: string): string {
  const parts = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part
      let s = part.replace(/([a-z0-9)\]"'’])([.!?])(?=[A-Z#*])/g, '$1$2\n\n')
      const next = parts[i + 1]
      if (next?.startsWith('`') && !next.startsWith('```') && /[a-z0-9)][.!?]$/.test(s)) s += '\n\n'
      return s
    })
    .join('')
}
