// How each service is presented.
//
// A lookup rather than a hardcoded list: the daemon says which connectors
// exist, and this only says how to draw the ones we have something nicer to
// say about. Anything new appears with a generated glyph and its own
// description from the manifest, which is why adding a connector to KARMAX
// needs no change here.
export interface Presentation {
  label: string
  /** What connecting it gets you, in one line. Never a description of the
   *  service — the person already knows what WhatsApp is. */
  blurb: string
}

export const PRESENTATION: Record<string, Presentation> = {
  whatsapp: {
    label: 'WhatsApp',
    blurb: 'Message your assistant like you would a person, and let it reply on your behalf.'
  },
  google: {
    label: 'Google',
    blurb: 'Calendar, Gmail, Drive, Docs and Chat.'
  },
  github: {
    label: 'GitHub',
    blurb: 'Read issues and pull requests, and open them.'
  },
  notion: { label: 'Notion', blurb: 'Read and write your pages and databases.' },
  slack: { label: 'Slack', blurb: 'Post to channels and answer where your team already talks.' },
  discord: { label: 'Discord', blurb: 'Talk to your assistant from a Discord server.' },
  jira: { label: 'Jira', blurb: 'Track and update issues.' },
  youtrack: { label: 'YouTrack', blurb: 'Track and update issues.' },
  linkedin: { label: 'LinkedIn', blurb: 'Post on your behalf.' },
  x: { label: 'X', blurb: 'Post on your behalf.' },
  instagram: { label: 'Instagram', blurb: 'Read and post to your account.' },
  keka: { label: 'Keka', blurb: 'Leave, attendance and people data.' },
  claude_code: { label: 'Claude Code', blurb: 'The brain. Does the thinking and holds the tools.' },
  codex: { label: 'Codex', blurb: 'An alternative brain.' },
  gateway: { label: 'AI gateway', blurb: 'Where the backup API models are served from.' },
  push: { label: 'Phone notifications', blurb: 'Where proactive messages are delivered.' },
  ntfy: { label: 'ntfy', blurb: 'Simple push notifications to any device.' },
}

/** Ids that name the same service by two different routes.
 *
 *  `google_workspace` was the gws CLI's session, and is kept here so an engine
 *  that has not been updated yet still draws its tile with a name and a blurb
 *  rather than as an unknown connector. */
const CANONICAL: Record<string, string> = {
  google_workspace: 'google',
  claude: 'claude_code',
  anthropic: 'claude_code',
}

export function canonical(id: string): string {
  return CANONICAL[id] ?? id
}

export function present(id: string, fallbackName?: string): Presentation {
  const known = PRESENTATION[canonical(id)] ?? PRESENTATION[id]
  if (known) return known
  // An unknown connector still gets a name; Glyph derives its colour from the
  // id, so it looks deliberate rather than unfinished.
  return { label: fallbackName || prettify(id), blurb: '' }
}

function prettify(id: string): string {
  return id
    .split(/[_\-.]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Every status word the daemon can produce, reduced to the four a person
 *  needs, and phrased so the tile can be read without a legend. */
export function readStatus(raw: string): { tone: 'ok' | 'warn' | 'bad' | 'idle'; label: string } {
  switch (raw) {
    case 'connected':
    case 'configured':
    case 'available':
    case 'healthy':
    case 'online':
    case 'registered':
      return { tone: 'ok', label: 'Connected' }
    case 'degraded':
      return { tone: 'warn', label: 'Needs a look' }
    case 'disconnected':
    case 'failed':
    case 'offline':
      return { tone: 'bad', label: 'Not working' }
    case 'missing':
      return { tone: 'bad', label: 'Not installed' }
    default:
      return { tone: 'idle', label: 'Not set up' }
  }
}
