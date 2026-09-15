// A loop's name and needs, in words a person would use.
//
// Registry names are slugs because they are file names; a card is not a file
// listing. The slug is still printed beside the title, because it is what the
// source and the command line call it.
const WORDS: Record<string, string> = { hn: 'HN', wa: 'WhatsApp', gchat: 'Google Chat', lyzn: 'LYZN', ai: 'AI', x: 'X' }

export function titleOf(name: string): string {
  const words = name.split('-').filter(Boolean)
  return words
    .map((w, i) => WORDS[w] ?? (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
}

const SERVICES: Record<string, string> = {
  whatsapp: 'WhatsApp', comms: 'Messaging', linkedin: 'LinkedIn', x: 'X', google_workspace: 'Google Workspace',
  google: 'Google', gmail: 'Gmail', slack: 'Slack', github: 'GitHub', instagram: 'Instagram',
  activity: 'Your activity', memory: 'Memory', calendar: 'Calendar', app: 'The LYZN app',
}

/** "whatsapp.monitored" and "whatsapp_search_messages" are both WhatsApp. */
export function serviceOf(requirement: string): string {
  const head = requirement.split(/[._:]/)[0]
  if (requirement.startsWith('google_workspace')) return SERVICES.google_workspace
  return SERVICES[head] ?? head.charAt(0).toUpperCase() + head.slice(1)
}
