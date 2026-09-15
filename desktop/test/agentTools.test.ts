// Adding a newly shipped tool to allowlists written before it existed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addAgentTools } from '../electron/agentTools.js'

const config = `# The operator's own notes stay put.
agents:
  - id: "karmax"
    # The tool list is an allowlist.
    tools:
      - harness.send # keep this comment
      - browser
  - id: "second"
    tools:
      - dashboard
  - id: "no-list"
loops: []
`

test('a missing tool is appended to each agent that has a list, comments kept', () => {
  const { text, added } = addAgentTools(config)
  assert.deepEqual(added, ['dashboard'])
  assert.match(text, /# The operator's own notes stay put\./)
  assert.match(text, /- harness\.send # keep this comment/)
  assert.match(text, /- browser\n\s+- dashboard/)
  assert.equal((text.match(/- dashboard/g) ?? []).length, 2, 'the agent that already had it is not given a second copy')
  assert.doesNotMatch(text.split('id: "no-list"')[1], /tools:/, 'an agent with no allowlist is left alone')
})

test('nothing to add leaves the text byte for byte', () => {
  const once = addAgentTools(config).text
  const again = addAgentTools(once)
  assert.deepEqual(again.added, [])
  assert.equal(again.text, once)
})

test('a config without agents is returned unchanged', () => {
  assert.deepEqual(addAgentTools('loops: []\n'), { text: 'loops: []\n', added: [] })
})
