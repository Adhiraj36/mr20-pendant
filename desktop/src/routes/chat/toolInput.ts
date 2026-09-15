// How a tool call's arguments read on screen.
//
// By what the arguments are rather than by tool name: the brain may be Claude
// Code or Codex, and a command is a command whichever of them ran it.
import type { ToolCall } from '@lyzn/chat-core'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', jsx: 'javascript', json: 'json',
  go: 'go', py: 'python', yml: 'yaml', yaml: 'yaml', toml: 'toml', swift: 'swift', sql: 'sql',
  html: 'html', css: 'css', md: 'markdown', rs: 'rust', sh: 'bash', zsh: 'bash', bash: 'bash',
}

export const langOf = (file: string): string => EXT[file.split('.').pop()?.toLowerCase() ?? ''] ?? ''

const diff = (before: string, after: string) =>
  [...before.split('\n').map((l) => `- ${l}`), ...after.split('\n').map((l) => `+ ${l}`)].join('\n')

/** A line of prose about the call, or a block of code from it. */
export type Piece = { note: string } | { lang: string; code: string }

export function inputPieces(input: Record<string, unknown>): Piece[] {
  const file = str(input.file_path) || str(input.notebook_path)
  const note = (s: string): Piece[] => (s ? [{ note: s }] : [])

  if (str(input.command)) return [...note(str(input.description)), { lang: 'bash', code: str(input.command) }]
  if (typeof input.old_string === 'string' || typeof input.new_string === 'string') {
    return [...note(file), { lang: 'diff', code: diff(str(input.old_string), str(input.new_string)) }]
  }
  if (Array.isArray(input.edits)) {
    const edits = input.edits as Record<string, unknown>[]
    return [...note(file), { lang: 'diff', code: edits.map((e) => diff(str(e.old_string), str(e.new_string))).join('\n\n') }]
  }
  if (typeof input.content === 'string') return [...note(file), { lang: langOf(file), code: input.content }]
  if (str(input.pattern)) {
    return [...note([str(input.path), str(input.glob)].filter(Boolean).join('  ')), { lang: '', code: str(input.pattern) }]
  }
  if (str(input.url)) return [...note(str(input.url)), ...(str(input.prompt) ? [{ lang: '', code: str(input.prompt) }] : [])]
  if (str(input.query)) return [{ lang: '', code: str(input.query) }]
  if (file && Object.keys(input).every((k) => ['file_path', 'notebook_path', 'offset', 'limit'].includes(k))) {
    return note(input.offset ? `${file}, from line ${Number(input.offset)}` : file)
  }
  return [{ lang: 'json', code: JSON.stringify(input, null, 2) }]
}

export const hasInput = (c: ToolCall): boolean => Boolean(c.input && Object.keys(c.input).length > 0)

/** A line opens only when there is something behind it; a call from an older
 *  engine that kept neither arguments nor output stays a plain line. */
export const openable = (c: ToolCall): boolean => hasInput(c) || Boolean(c.output?.trim())
