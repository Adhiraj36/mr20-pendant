import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveRows, emptyUi, summarise, WORK_GROUP_LIMIT } from '../src/rows.ts'
import type { Message, ToolCall } from '../src/types.ts'

const call = (id: string, kind: ToolCall['kind'], status: ToolCall['status'] = 'completed'): ToolCall =>
  ({ id, kind, status, title: `${id}.go` })

const reply = (over: Partial<Message> = {}): Message => ({
  id: 'a1', role: 'assistant', text: '', thought: '',
  toolCalls: [], plan: [], cards: [], ...over,
})

const asked = (text = 'go'): Message => ({
  id: 'u1', role: 'user', text, thought: '', toolCalls: [], plan: [], cards: [],
})

test('a bare exchange is two message rows', () => {
  const rows = deriveRows([asked(), reply({ text: 'Done.' })], emptyUi)
  assert.deepEqual(rows.map((r) => r.kind), ['message', 'message'])
})

// Twelve reads and one command must not be thirteen lines.
test('consecutive calls of one kind become a single work row', () => {
  const rows = deriveRows(
    [asked(), reply({ toolCalls: [call('a', 'read'), call('b', 'read'), call('c', 'read')], text: 'ok' })],
    emptyUi,
  )
  const work = rows.filter((r) => r.kind === 'work')
  assert.equal(work.length, 1)
  assert.equal(work[0].kind === 'work' && work[0].calls.length, 3)
})

// "read three, run one, read two more" is three groups, and saying otherwise
// would be a lie about what happened.
test('a different kind breaks the group', () => {
  const rows = deriveRows(
    [asked(), reply({
      toolCalls: [call('a', 'read'), call('b', 'read'), call('c', 'execute'), call('d', 'read')],
      text: 'ok',
    })],
    emptyUi,
  )
  const work = rows.filter((r) => r.kind === 'work')
  assert.equal(work.length, 3)
})

// The one still running is always its own row, always visible.
test('a running call gets its own live row', () => {
  const rows = deriveRows(
    [asked(), reply({ toolCalls: [call('a', 'read'), call('b', 'execute', 'in_progress')], streaming: true })],
    emptyUi,
  )
  assert.equal(rows.filter((r) => r.kind === 'work-live').length, 1)
  const live = rows.find((r) => r.kind === 'work-live')
  assert.equal(live?.kind === 'work-live' && live.call.id, 'b')
})

// An unsettled call breaks a group, even if the same kind resumes after.
// Rows must be emitted in source order: work(read a), live(execute b), work(read c).
test('an unsettled call breaks grouping and rows are emitted in source order', () => {
  const rows = deriveRows(
    [asked(), reply({
      toolCalls: [call('a', 'read', 'completed'), call('b', 'execute', 'in_progress'), call('c', 'read', 'completed')],
      text: 'ok',
    })],
    emptyUi,
  )
  const sequence = rows.map((r) => {
    if (r.kind === 'work') return `work:${r.calls[0].id}`
    if (r.kind === 'work-live') return `live:${r.call.id}`
    return null
  }).filter(x => x)
  assert.deepEqual(sequence.slice(0, 3), ['work:a', 'live:b', 'work:c'])
})

// Multiple concurrent calls all stay visible.
test('multiple running calls each get their own live row', () => {
  const rows = deriveRows(
    [asked(), reply({
      toolCalls: [call('a', 'read', 'in_progress'), call('b', 'execute', 'in_progress')],
      streaming: true,
    })],
    emptyUi,
  )
  const live = rows.filter((r) => r.kind === 'work-live')
  assert.equal(live.length, 2)
  assert.equal(live[0].kind === 'work-live' && live[0].call.id, 'a')
  assert.equal(live[1].kind === 'work-live' && live[1].call.id, 'b')
})

test('beyond the limit the older groups fold behind a toggle', () => {
  assert.equal(WORK_GROUP_LIMIT, 4, 'WORK_GROUP_LIMIT must be exactly 4')
  const kinds: ToolCall['kind'][] = ['read', 'execute', 'search', 'fetch', 'edit', 'read']
  const rows = deriveRows(
    [asked(), reply({ toolCalls: kinds.map((k, i) => call(`t${i}`, k)), text: 'ok' })],
    emptyUi,
  )
  const toggleIndex = rows.findIndex((r) => r.kind === 'work-toggle')
  assert.ok(toggleIndex >= 0, 'expected a toggle row')
  const toggle = rows[toggleIndex]
  assert.equal(toggle.kind === 'work-toggle' && toggle.hidden, 2, 'should hide 2 oldest groups')
  // The toggle sits above every group, collapsed or not — right after the
  // question that started the turn.
  assert.equal(toggleIndex, 1, 'toggle should be the row right after the question')
  const work = rows.filter((r) => r.kind === 'work')
  assert.equal(work.length, 4, 'should show exactly 4 most recent groups')
  // Verify the most recent 4 groups are shown: search, fetch, edit, read
  assert.equal(work[0].kind === 'work' && work[0].calls[0].kind, 'search')
  assert.equal(work[1].kind === 'work' && work[1].calls[0].kind, 'fetch')
  assert.equal(work[2].kind === 'work' && work[2].calls[0].kind, 'edit')
  assert.equal(work[3].kind === 'work' && work[3].calls[0].kind, 'read')
})

test('expanding the toggle shows every group', () => {
  const kinds: ToolCall['kind'][] = ['read', 'execute', 'search', 'fetch', 'edit', 'read']
  const ui = { ...emptyUi, expandedWork: new Set(['a1']) }
  const rows = deriveRows([asked(), reply({ toolCalls: kinds.map((k, i) => call(`t${i}`, k)), text: 'ok' })], ui)
  const work = rows.filter((r) => r.kind === 'work')
  assert.equal(work.length, 6, 'expanded should show all 6 groups')
  const toggleIndex = rows.findIndex((r) => r.kind === 'work-toggle')
  assert.ok(toggleIndex >= 0, 'toggle should still be present when expanded')
  assert.equal(rows[toggleIndex].kind === 'work-toggle' && rows[toggleIndex].expanded, true)
  // Same position as collapsed — the control must not jump under the click
  // that just expanded it.
  assert.equal(toggleIndex, 1, 'toggle should stay the row right after the question when expanded')
})

test('the fold hides older groups but live calls survive and stay in order', () => {
  const calls = [
    call('g1', 'read'), call('g2', 'execute'), call('g3', 'search'), call('g4', 'fetch'),
    call('live1', 'edit', 'in_progress'),
    call('g5', 'edit'), call('g6', 'read'),
  ]
  const rows = deriveRows([asked(), reply({ toolCalls: calls, text: 'ok' })], emptyUi)
  const sequence = rows.map((r) => {
    if (r.kind === 'work-toggle') return 'toggle'
    if (r.kind === 'work') return `work:${r.calls[0].id}`
    if (r.kind === 'work-live') return `live:${r.call.id}`
    return null
  }).filter(x => x)
  // Groups: read, execute, search, fetch, edit, read = 6 groups (>4 limit)
  // Hidden: read (g1), execute (g2) = 2 oldest groups
  // Shown: search (g3), fetch (g4), edit (g5), read (g6)
  // But live1 appears between g4 and g5 in source order, so:
  // Expected: toggle, work:g3, work:g4, live:live1, work:g5, work:g6
  assert.deepEqual(sequence.slice(0, 6), ['toggle', 'work:g3', 'work:g4', 'live:live1', 'work:g5', 'work:g6'])
})

test('a thought is its own row, collapsed by default', () => {
  const rows = deriveRows([asked(), reply({ thought: 'hmm', text: 'Yes.' })], emptyUi)
  const t = rows.find((r) => r.kind === 'thought')
  assert.ok(t)
  assert.equal(t.kind === 'thought' && t.expanded, false)
  const open = deriveRows(
    [asked(), reply({ thought: 'hmm', text: 'Yes.' })],
    { ...emptyUi, expandedThoughts: new Set(['a1']) },
  )
  const t2 = open.find((r) => r.kind === 'thought')
  assert.equal(t2?.kind === 'thought' && t2.expanded, true)
})

test('a plan becomes one row', () => {
  const rows = deriveRows(
    [asked(), reply({ plan: [{ content: 'one', status: 'pending' }], text: 'ok' })],
    emptyUi,
  )
  assert.equal(rows.filter((r) => r.kind === 'plan').length, 1)
})

test('meta appears only on a settled reply', () => {
  const settled = deriveRows([asked(), reply({ text: 'ok', meta: { model: 'x', durationMs: 10 } })], emptyUi)
  assert.equal(settled.filter((r) => r.kind === 'meta').length, 1)
  const live = deriveRows(
    [asked(), reply({ text: 'ok', streaming: true, meta: { model: 'x', durationMs: 10 } })],
    emptyUi,
  )
  assert.equal(live.filter((r) => r.kind === 'meta').length, 0)
})

// Forty turns has to stay navigable.
test('a folded turn collapses to its question', () => {
  const rows = deriveRows(
    [asked('what is up'), reply({ text: 'much', toolCalls: [call('a', 'read')] })],
    { ...emptyUi, foldedTurns: new Set(['u1']) },
  )
  assert.deepEqual(rows.map((r) => r.kind), ['turn-fold'])
  assert.equal(rows[0].kind === 'turn-fold' && rows[0].label, 'what is up')
})

test('every row id is unique across a multi-turn conversation', () => {
  const rows = deriveRows(
    [
      { id: 'u1', role: 'user', text: 'first', thought: '', toolCalls: [], plan: [], cards: [] },
      {
        id: 'a1', role: 'assistant', text: 'reply', thought: 'thinking',
        toolCalls: [call('x', 'read'), call('y', 'execute')],
        plan: [{ content: 'step', status: 'pending' }],
        cards: [], meta: { model: 'm1' },
      },
      { id: 'u2', role: 'user', text: 'second', thought: '', toolCalls: [], plan: [], cards: [] },
      {
        id: 'a2', role: 'assistant', text: 'done', thought: 'more',
        toolCalls: [call('z', 'fetch'), call('w', 'edit')],
        plan: [{ content: 'other', status: 'completed' }],
        cards: [], meta: { model: 'm2' },
      },
    ],
    emptyUi,
  )
  const ids = rows.map((r) => r.id)
  assert.equal(new Set(ids).size, ids.length, `duplicate row ids: ${ids.join(', ')}`)
})

test('one call says what it touched; several say how many', () => {
  assert.equal(summarise([call('a', 'read')]), 'read a.go')
  assert.equal(summarise([call('a', 'read'), call('b', 'read')]), 'read 2 files')
  assert.equal(summarise([call('a', 'execute'), call('b', 'execute'), call('c', 'execute')]), 'ran 3 commands')
})

// 'other' calls (AskUserQuestion, Skill, ToolSearch, delegations) share no
// verb or noun, so a group of them must not read as "ran N things" — it
// names the first call's own title instead, same as the single-call case.
test('a group of other calls names the first title instead of counting things', () => {
  const q1 = { id: 'a', kind: 'other' as const, status: 'completed' as const, title: 'Asked which file to use' }
  const q2 = { id: 'b', kind: 'other' as const, status: 'completed' as const, title: 'Used the Recall skill' }
  assert.equal(summarise([q1, q2]), 'Asked which file to use and 1 more')

  const q3 = { id: 'c', kind: 'other' as const, status: 'completed' as const, title: 'Searched for a skill' }
  const text = summarise([q1, q2, q3])
  assert.equal(text, 'Asked which file to use and 2 more')
  assert.ok(!text.includes('things'))
})

test('a group of switch_mode calls also names the first title', () => {
  const m1 = { id: 'a', kind: 'switch_mode' as const, status: 'completed' as const, title: 'Switched to plan mode' }
  const m2 = { id: 'b', kind: 'switch_mode' as const, status: 'completed' as const, title: 'Switched to build mode' }
  assert.equal(summarise([m1, m2]), 'Switched to plan mode and 1 more')
})

// A Bash call's title is often an agent-written description ("Check the
// tests still pass"), not a bare token — that title already reads as a
// sentence, so a single call must not bolt "ran" onto its front. A title
// that is just a token (a filename, a glob, a host) still keeps its verb,
// and that holds even when the token itself contains a space, like a Go
// search pattern.
test('a single call with a written-phrase title drops its verb', () => {
  const ran = { id: 'a', kind: 'execute' as const, status: 'completed' as const, title: 'Check the tests still pass' }
  assert.equal(summarise([ran]), 'Check the tests still pass')

  const wrote = { id: 'b', kind: 'edit' as const, status: 'completed' as const, title: 'CHANGELOG.md' }
  assert.equal(summarise([wrote]), 'wrote CHANGELOG.md')

  const searched = { id: 'c', kind: 'search' as const, status: 'completed' as const, title: 'func main' }
  assert.equal(summarise([searched]), 'searched func main')
})

test('multi-call summaries are unaffected by the written-phrase rule', () => {
  assert.equal(summarise([call('a', 'read'), call('b', 'read')]), 'read 2 files')
  assert.equal(summarise([call('a', 'execute'), call('b', 'execute'), call('c', 'execute')]), 'ran 3 commands')
})
