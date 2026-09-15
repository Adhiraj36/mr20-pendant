// A dashboard an agent saved during a turn, as a card in the reply.
//
// Engine agents call the dashboard tool directly; Claude Code reaches it with
// `karmax tool call dashboard --json '…'` in a shell. Either way the only
// proof the save happened is the tool's own answer, so a card is drawn from
// that, never from what the agent said it was doing.
import type { Card, ToolCall } from '@lyzn/chat-core'

function firstObject(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const v = JSON.parse(text.slice(start, end + 1))
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const saved = (o: Record<string, unknown> | null): { id: string } | null => {
  if (!o) return null
  const inner = o.output && typeof o.output === 'object' ? (o.output as Record<string, unknown>) : o
  return inner.saved === true && typeof inner.id === 'string' ? { id: inner.id } : null
}

const cliArgs = (command: string) => {
  const m = /--json\s+(?:'([\s\S]*)'|"((?:[^"\\]|\\.)*)")/.exec(command)
  return firstObject(m ? (m[1] ?? m[2]?.replace(/\\"/g, '"')) : undefined)
}

export function dashboardCards(calls: ToolCall[]): Card[] {
  const byId = new Map<string, Card>()
  for (const call of calls) {
    if (call.status !== 'completed') continue
    const input = call.input ?? {}
    const command = typeof input.command === 'string' ? input.command : ''
    const viaCli = /\bkarmax\s+tool\s+call\s+dashboard\b/.test(command)
    const direct = !viaCli && input.action === 'save'
    if (!viaCli && !direct) continue
    const result = saved(firstObject(call.output))
    if (!result) continue
    const args = viaCli ? cliArgs(command) : input
    const title = typeof args?.title === 'string' && args.title.trim() ? args.title.trim() : result.id
    byId.set(result.id, { kind: 'dashboard', id: result.id, title, status: 'Saved', live: false })
  }
  return [...byId.values()]
}
