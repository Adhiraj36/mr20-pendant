// What Mira draws from a transcript Claude Code wrote, without a DOM.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conversationTitle, dayGroup, injected, shortAgo, squeezeTerminal, stripGlyphs, unglue } from '../src/routes/chat/clean.js'

test('a caveat is never a title; the AI title wins, then the opening', () => {
  assert.equal(conversationTitle({ title: '', opening: '<local-command-caveat>Caveat: The messages below' }), 'Untitled conversation')
  assert.equal(conversationTitle({ title: 'Squid on EC2', opening: 'set up squid' }), 'Squid on EC2')
  assert.equal(conversationTitle({ title: '', opening: '  fix   the\nbuild ' }), 'fix the build')
})

test('CLI furniture is recognised, and what the person typed is not', () => {
  assert.deepEqual(injected('Base directory for this skill: /Users/x/skills/systematic-debugging\n\n# Systematic'), {
    kind: 'skill',
    name: 'systematic-debugging',
  })
  assert.deepEqual(injected('<command-name>/clear</command-name>\n<command-message>clear</command-message>'), {
    kind: 'command',
    name: '/clear',
  })
  assert.deepEqual(injected('<local-command-stdout></local-command-stdout>'), { kind: 'silent' })
  assert.equal(injected('Why is my disk full?'), null)
})

test('nerd font glyphs go; prompt padding shrinks to two spaces', () => {
  assert.equal(stripGlyphs('\uE0B6 ~ \u{F0001}base'), ' ~ base')
  assert.equal(squeezeTerminal('\u256E vphone-cli            \u256F   '), '\u256E vphone-cli  \u256F')
})

test('a conversation from late yesterday is under Yesterday and reads in hours or 1d', () => {
  const now = new Date('2026-09-14T10:00:00')
  const then = new Date('2026-09-13T08:00:00')
  assert.equal(dayGroup(then.toISOString(), now), 'Yesterday')
  assert.equal(shortAgo(then.toISOString(), now.getTime()), '1d')
  assert.equal(dayGroup(new Date('2026-09-14T00:30:00').toISOString(), now), 'Today')
})

test('glued prose is split into paragraphs', () => {
  assert.equal(unglue('Let me check.Found it'), 'Let me check.\n\nFound it')
  assert.equal(unglue('the prerequisites.## Root cause'), 'the prerequisites.\n\n## Root cause')
  assert.equal(unglue('Let me get it.`ls` is aliased'), 'Let me get it.\n\n`ls` is aliased')
  assert.equal(unglue('crashes at **12:50** too.**Mid-run** as well'), 'crashes at **12:50** too.\n\n**Mid-run** as well')
})

test('code and ordinary sentences are left exactly as they were', () => {
  const same = [
    'call `os.Exit` here.',
    '```go\nfmt.Println("x.Y")\n```',
    'Version 1.2 is out. Next week, 2.0.',
    'See U.S.A and e.g. this.',
  ]
  for (const s of same) assert.equal(unglue(s), s)
})

test('the brief a task is handed is not drawn as something the person said', () => {
  assert.deepEqual(injected('# KARMAX context (auto-injected)\n\n## Possibly relevant memory\n- a fact'), { kind: 'brief' })
  assert.deepEqual(injected('The person wearing a LYZN pendant promised this out loud, and has now approved it'), { kind: 'brief' })
  assert.equal(injected('The person I met promised to call'), null)
})
