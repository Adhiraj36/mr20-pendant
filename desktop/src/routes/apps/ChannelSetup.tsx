// Bot tokens for the chat channels.
//
// These live in karmax.yaml rather than the credential store — comms channels
// are configuration, not connectors — so this writes the file directly and is
// honest that the change lands on the next restart.
import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { Channel } from '@shared/types'
import { Button, Field, Input } from '@/components/ui'
import { Modal } from '@/components/Overlays'

const COPY = {
  discord: {
    name: 'Discord',
    help: 'Create an application in the Discord developer portal, add a bot to it, and copy the bot token.',
    url: 'https://discord.com/developers/applications',
    extra: null as null | { key: string; label: string; hint: string },
  },
  slack: {
    name: 'Slack',
    help: 'Create an app in the Slack API dashboard, give it a bot token scope, and install it to your workspace.',
    url: 'https://api.slack.com/apps',
    extra: { key: 'app_token', label: 'App-level token', hint: 'Starts with xapp- ; needed for Socket Mode.' },
  },
}

export function ChannelSetup({
  open,
  type,
  onClose,
  onSaved,
}: {
  open: boolean
  type: 'discord' | 'slack'
  onClose: () => void
  onSaved: () => void
}) {
  const copy = COPY[type]
  const [token, setToken] = useState('')
  const [extra, setExtra] = useState('')
  const [existing, setExisting] = useState<Channel | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setToken('')
    setExtra('')
    void window.karmax.config.settings().then((s) => {
      setExisting(s.channels.find((c) => c.type === type) ?? null)
    })
  }, [open, type])

  async function save() {
    setBusy(true)
    try {
      const settings = await window.karmax.config.settings()
      const id = existing?.id ?? `${type}-main`
      const next: Channel = {
        id,
        type,
        agent_id: 'karmax',
        token: token.trim() || existing?.token || '',
        settings: {
          ...(existing?.settings ?? {}),
          ...(copy.extra && extra.trim() ? { [copy.extra.key]: extra.trim() } : {}),
        },
      }
      // patch() does not reach comms.channels, so this goes through the raw
      // document — the one place the app rewrites a list wholesale.
      const raw = await window.karmax.config.raw()
      const others = settings.channels.filter((c) => c.id !== id)
      const merged = [...others, next]
      const text = replaceChannels(raw.text, merged)
      const res = await window.karmax.config.writeRaw(text)
      if (res.ok) {
        onSaved()
        onClose()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Connect ${copy.name}`}
      lede="The token stays on this computer, in your settings file."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!token.trim() && !existing}
            onClick={() => void save()}
          >
            Save
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] leading-relaxed text-[var(--fg-dim)]">{copy.help}</p>
      <Button
        size="sm"
        variant="ghost"
        className="mt-3"
        icon={<ExternalLink size={13} />}
        onClick={() => void window.karmax.app.openExternal(copy.url)}
      >
        Open the developer portal
      </Button>

      <Field
        label="Bot token"
        hint={existing?.token ? 'A token is already saved. Leave blank to keep it.' : undefined}
      >
        <Input
          type="password"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={existing?.token ? '••••••••' : 'Paste the token'}
        />
      </Field>

      {copy.extra && (
        <Field label={copy.extra.label} hint={copy.extra.hint}>
          <Input
            type="password"
            spellCheck={false}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
          />
        </Field>
      )}

      <p className="mt-2 text-[12.5px] text-[var(--fg-dim)]">
        Channels are read when the engine starts, so this takes effect after a restart.
      </p>
    </Modal>
  )
}

/** Swap the comms.channels block for a fresh one.
 *
 *  A YAML rewrite done with text rather than the document API, because this is
 *  the one edit that replaces a whole list: setIn on a sequence of maps
 *  reformats every entry, which would churn a file people also edit by hand. */
function replaceChannels(text: string, channels: Channel[]): string {
  const body = channels
    .map((c) => {
      const lines = [
        `    - id: "${esc(c.id)}"`,
        `      type: "${esc(c.type)}"`,
        `      agent_id: "${esc(c.agent_id)}"`,
        `      token: "${esc(c.token)}"`,
      ]
      const entries = Object.entries(c.settings ?? {}).filter(([, v]) => String(v).trim())
      if (entries.length) {
        lines.push('      settings:')
        for (const [k, v] of entries) lines.push(`        ${k}: "${esc(String(v))}"`)
      }
      return lines.join('\n')
    })
    .join('\n')

  const block = `comms:\n  channels:\n${body || '    []'}\n`

  // Replace from `comms:` up to the next top-level key.
  const re = /^comms:\s*\n(?:[ \t].*\n|\n)*/m
  if (re.test(text)) return text.replace(re, block)
  return text.trimEnd() + '\n\n' + block
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
