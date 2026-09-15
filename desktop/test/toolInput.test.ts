// What an opened tool call shows, by the shape of its arguments.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inputPieces, langOf, openable } from '../src/routes/chat/toolInput.js'

test('a command is its description, then the command as bash', () => {
  assert.deepEqual(inputPieces({ command: 'df -h /', description: 'Check free space' }), [
    { note: 'Check free space' },
    { lang: 'bash', code: 'df -h /' },
  ])
})

test('an edit reads as a diff of what it replaced', () => {
  assert.deepEqual(inputPieces({ file_path: '/a/main.go', old_string: 'x := 1', new_string: 'x := 2\ny := 3' }), [
    { note: '/a/main.go' },
    { lang: 'diff', code: '- x := 1\n+ x := 2\n+ y := 3' },
  ])
})

test('a written file is highlighted by its extension', () => {
  assert.deepEqual(inputPieces({ file_path: '/a/b.py', content: 'print(1)' }), [
    { note: '/a/b.py' },
    { lang: 'python', code: 'print(1)' },
  ])
  assert.equal(langOf('Dockerfile'), '')
})

test('a read is only the path', () => {
  assert.deepEqual(inputPieces({ file_path: '/a/b.ts', offset: 40, limit: 20 }), [{ note: '/a/b.ts, from line 40' }])
})

test('anything unrecognised is shown as its JSON, not dropped', () => {
  assert.deepEqual(inputPieces({ subagent_type: 'Explore', prompt_id: 7 }), [
    { lang: 'json', code: '{\n  "subagent_type": "Explore",\n  "prompt_id": 7\n}' },
  ])
})

test('a call with neither arguments nor output does not open', () => {
  assert.equal(openable({ id: '1', status: 'completed', title: 'a command' }), false)
  assert.equal(openable({ id: '1', status: 'completed', output: 'ok' }), true)
  assert.equal(openable({ id: '1', status: 'in_progress', input: { command: 'ls' } }), true)
})
