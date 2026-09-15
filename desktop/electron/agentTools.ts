// Tools an agent must be allowed to call, added to a config written before
// they existed.
//
// An agent's `tools:` list in karmax.yaml is an allowlist, written once at
// setup. A tool that ships later is registered in the engine and still refused
// to every existing install, because nobody's list names it — which is how the
// dashboard tool answered "unknown tool" on a machine set up the week before.
// Edited through the YAML document, so the comments people keep in that file
// survive.
import YAML from 'yaml'

/** What every agent needs, whenever its config was written. */
export const REQUIRED_AGENT_TOOLS = ['dashboard']

export function addAgentTools(text: string, names: string[] = REQUIRED_AGENT_TOOLS): { text: string; added: string[] } {
  const doc = YAML.parseDocument(text)
  const agents = doc.get('agents')
  if (!YAML.isSeq(agents)) return { text, added: [] }
  const added = new Set<string>()
  agents.items.forEach((_, i) => {
    const list = doc.getIn(['agents', i, 'tools'])
    // No list at all is not an allowlist to extend; leave that agent alone.
    if (!YAML.isSeq(list)) return
    const have = new Set(list.items.map((item) => String(YAML.isScalar(item) ? item.value : item)))
    for (const name of names) {
      if (have.has(name)) continue
      doc.addIn(['agents', i, 'tools'], name)
      added.add(name)
    }
  })
  return added.size ? { text: doc.toString(), added: [...added] } : { text, added: [] }
}
