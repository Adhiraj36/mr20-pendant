// Everything KARMAX can be plugged into.
//
// Three kinds of thing, which the page keeps apart because they fail in
// different ways: accounts paired on this machine, services reached with a
// credential, and chat channels the assistant speaks through.
import { useEffect, useState } from 'react'
import { ChevronRight, Plug, RefreshCw } from 'lucide-react'
import type { Connectable, DaemonStatus, Integration } from '@shared/types'
import { Badge, Button, EmptyState, Panel, PageHeader, SectionHeader, Spinner, Tile } from '@/components/ui'
import { useToast } from '@/components/Overlays'
import { useAsync } from '@/lib/hooks'
import { Glyph } from '@/routes/apps/Glyph'
import { canonical, present, readStatus } from '@/routes/apps/catalogue'
import { PairFlow } from '@/routes/apps/PairFlow'
import { ConnectFlow } from '@/routes/apps/ConnectFlow'
import { SharedBrowser } from '@/routes/apps/SharedBrowser'
import { ConnectorSetup } from '@/routes/apps/ConnectorSetup'
import { ChannelSetup } from '@/routes/apps/ChannelSetup'

interface Connector {
  id: string
  name: string
  status: string
  detail: string
  last_checked_at: string | null
}

/** The channels you can message the assistant from. Presented as chat rather
 *  than as connectors because a bot token is all each one needs, and because
 *  "where can I talk to it" is a different question from "what can it reach". */
const CHAT_CHANNELS = ['discord', 'slack'] as const

/** Things whose status comes from a program on this machine rather than a
 *  credential, and which therefore need a pairing flow rather than a form.
 *
 *  Only WhatsApp now. Google used to be here too, as `gws auth login` — one
 *  command that printed a link. It is not one command any more: it is a cloud
 *  project, six APIs, a consent screen and an OAuth client, which is why it
 *  goes through the connect agent instead. */
const HOST_FLOWS: Record<
  string,
  {
    action: 'whatsapp.pair'
    title: string
    lede: string
    instructions: string
    /** Put on the machine first if it is not there. Connecting an app is the
     *  moment somebody has decided they want it; that is the moment to install
     *  what it needs, not to hand them a link. */
    requires: { id: string; install: 'install.wacli'; name: string }
    /** Pairing links the phone; something else has to hold the line open. */
    connects?: 'whatsapp'
  }
> = {
  whatsapp: {
    action: 'whatsapp.pair',
    requires: { id: 'wacli', install: 'install.wacli', name: 'the WhatsApp bridge' },
    connects: 'whatsapp',
    title: 'Pair WhatsApp',
    lede: 'This links your own WhatsApp account, the same way WhatsApp Web does.',
    instructions:
      'On your phone, open WhatsApp → Settings → Linked devices → Link a device, then scan the code below. Your chats sync straight afterwards and keep syncing in the background. LYZN will be able to read and send messages as you, so treat it like any other linked device.',
  },
}

export default function Apps({ status }: { status: DaemonStatus | null }) {
  const toast = useToast()
  const running = status?.state === 'running'
  const [pairing, setPairing] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<{ id: string; name: string } | null>(null)
  const [agentConnect, setAgentConnect] = useState<Connectable | null>(null)
  const [channel, setChannel] = useState<'discord' | 'slack' | null>(null)

  const integrations = useAsync(async () => {
    if (!running) return null
    const res = await window.karmax.api.get<{ integrations: Integration[] }>('/api/integrations')
    return res.ok ? (res.data?.integrations ?? []) : []
  }, [running])

  // What an agent can connect for them, straight from the engine — so a
  // service that gains a recipe appears here without this file changing.
  const connectable = useAsync(async () => {
    if (!running) return null
    return window.karmax.connect.list()
  }, [running])

  const connectors = useAsync(async () => {
    if (!running) return null
    const res = await window.karmax.console.request<{ connectors: Connector[] }>(
      'GET',
      '/api/console/connectors',
    )
    return res.ok ? (res.data?.connectors ?? []) : []
  }, [running])

  // The engine coming up is the moment these lists become answerable.
  useEffect(() => {
    if (running) {
      integrations.reload()
      connectors.reload()
      connectable.reload()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  if (!running) {
    return (
      <>
        <PageHeader title="Apps" lede="Connect the things you already use." />
        <Panel>
          <EmptyState
            icon={<Plug size={26} />}
            title="The engine is not running"
            body="Start it on the Dashboard page and this will fill in with everything you can connect."
          />
        </Panel>
      </>
    )
  }

  const byId = new Map((integrations.data ?? []).map((i) => [i.id, i]))
  const agentByID = new Map((connectable.data ?? []).map((c) => [c.id, c]))
  const ACCOUNT_IDS = ['whatsapp', 'google', 'google_workspace']
  const accounts = ACCOUNT_IDS.map((id) => byId.get(id)).filter((x): x is Integration => !!x)

  // Some services reach KARMAX two ways and so appear on two lists: Google as
  // both a paired account and an OAuth connector, Slack as both a connector
  // and a chat channel. Both routes are real, but a person reading this page
  // sees one service contradicting itself — "Connected" beside "Not set up" —
  // so each is shown once, in the section where it is actually set up.
  const shownElsewhere = [...ACCOUNT_IDS, ...CHAT_CHANNELS]
  const services = (connectors.data ?? []).filter(
    (c) => !shownElsewhere.includes(canonical(c.id)),
  )

  const brains = ['claude_code', 'codex', 'gateway']
    .map((id) => byId.get(id))
    .filter((x): x is Integration => !!x)

  return (
    <>
      <PageHeader
        title="Apps"
        lede="Connect the things you already use. Each one gives your assistant something new it can actually do."
        action={
          <Button
            variant="ghost"
            icon={<RefreshCw size={14} />}
            onClick={() => {
              integrations.reload()
              connectors.reload()
            }}
          >
            Refresh
          </Button>
        }
      />

      <SharedBrowser running={running} />

      <Panel className="mb-4">
        <SectionHeader
          title="Your accounts"
          hint="Paired on this computer, so the assistant acts as you rather than as a bot."
        />
        {integrations.loading ? (
          <Spinner />
        ) : (
          <div className="grid grid-cols-2 items-stretch gap-3">
            {accounts.map((i) => (
              <AppTile
                key={i.id}
                id={i.id}
                name={present(i.id, i.name).label}
                blurb={present(i.id, i.name).blurb}
                status={i.status}
                detail={i.detail}
                onClick={
                  HOST_FLOWS[i.id]
                    ? () => setPairing(i.id)
                    : agentByID.has(canonical(i.id))
                      ? () => setAgentConnect(agentByID.get(canonical(i.id))!)
                      : undefined
                }
              />
            ))}
          </div>
        )}
      </Panel>

      <Panel className="mb-4">
        <SectionHeader
          title="Services"
          hint="Reached with a token or a sign-in. LYZN checks each one in the background and tells you when one stops working."
        />
        {connectors.loading ? (
          <Spinner />
        ) : services.length === 0 ? (
          <p className="py-1 text-[13px] text-[var(--fg-dim)]">
            This build has no connectors compiled in.
          </p>
        ) : (
          <div className="grid grid-cols-2 items-stretch gap-3">
            {services.map((c) => (
              <AppTile
                key={c.id}
                id={c.id}
                name={present(c.id, c.name).label}
                blurb={present(c.id, c.name).blurb}
                status={c.status}
                detail={c.detail}
                onClick={
                  agentByID.has(canonical(c.id))
                    ? () => setAgentConnect(agentByID.get(canonical(c.id))!)
                    : () => setConnecting({ id: c.id, name: present(c.id, c.name).label })
                }
              />
            ))}
          </div>
        )}
      </Panel>

      <Panel className="mb-4">
        <SectionHeader
          title="Chat channels"
          hint="Where you can message the assistant from. A bot token is all each one needs."
        />
        <div className="grid grid-cols-2 items-stretch gap-3">
          <AppTile
            id="discord"
            name="Discord"
            blurb={present('discord').blurb}
            status={byId.get('discord')?.status ?? 'off'}
            detail={byId.get('discord')?.detail ?? 'not configured'}
            onClick={() => setChannel('discord')}
          />
          <AppTile
            id="slack"
            name="Slack"
            blurb={present('slack').blurb}
            status="off"
            detail="not configured"
            onClick={() => setChannel('slack')}
          />
        </div>
      </Panel>

      <Panel>
        <SectionHeader
          title="The brain"
          hint="Not something you connect — something that has to be installed. Shown here so you can see whether it is."
        />
        <div className="grid grid-cols-3 gap-3">
          {brains.map((i) => {
            const s = readStatus(i.status)
            const p = present(i.id, i.name)
            return (
              <Tile key={i.id}>
                <div className="flex items-center gap-2.5">
                  <Glyph id={i.id} label={p.label} size={28} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{p.label}</span>
                    <Badge tone={s.tone} className="mt-1">
                      {s.label}
                    </Badge>
                  </span>
                </div>
                <p className="selectable mt-2.5 truncate font-mono text-[11px] text-[var(--fg-faint)]">
                  {i.detail}
                </p>
              </Tile>
            )
          })}
        </div>
      </Panel>

      {pairing && HOST_FLOWS[pairing] && (
        <PairFlow
          open
          onClose={() => {
            setPairing(null)
            integrations.reload()
          }}
          action={HOST_FLOWS[pairing].action}
          title={HOST_FLOWS[pairing].title}
          lede={HOST_FLOWS[pairing].lede}
          instructions={HOST_FLOWS[pairing].instructions}
          requires={HOST_FLOWS[pairing].requires}
          connects={HOST_FLOWS[pairing].connects}
          onFinished={(ok) => {
            if (ok) toast('Paired.', 'ok')
            integrations.reload()
          }}
        />
      )}

      {agentConnect && (
        <ConnectFlow
          open
          id={agentConnect.id}
          name={present(agentConnect.id, agentConnect.name).label}
          lede={agentConnect.lede}
          onClose={() => {
            setAgentConnect(null)
            integrations.reload()
            connectors.reload()
          }}
          onFinished={(ok) => {
            if (ok) toast('Connected.', 'ok')
            integrations.reload()
            connectors.reload()
          }}
        />
      )}

      {connecting && (
        <ConnectorSetup
          open
          id={connecting.id}
          name={connecting.name}
          onClose={() => setConnecting(null)}
          onSaved={connectors.reload}
        />
      )}

      {channel && (
        <ChannelSetup
          open
          type={channel}
          onClose={() => setChannel(null)}
          onSaved={() => {
            integrations.reload()
            toast('Saved. Restart the engine on the Dashboard page to start using it.', 'ok')
          }}
        />
      )}
    </>
  )
}

function AppTile({
  id,
  name,
  blurb,
  status,
  detail,
  onClick,
}: {
  id: string
  name: string
  blurb: string
  status: string
  detail: string
  onClick?: () => void
}) {
  const s = readStatus(status)
  return (
    <Tile onClick={onClick} className="group h-full">
      <div className="flex h-full items-start gap-3">
        <Glyph id={id} label={name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13.5px] font-medium">{name}</span>
            {onClick && (
              <ChevronRight
                size={15}
                className="shrink-0 text-[var(--fg-faint)] transition-transform duration-200 group-hover:translate-x-0.5"
              />
            )}
          </div>
          <Badge tone={s.tone} className="mt-1.5">
            {s.label}
          </Badge>
          <p className="mt-2 line-clamp-2 text-[12px] leading-snug text-[var(--fg-dim)]">
            {blurb || detail}
          </p>
        </div>
      </div>
    </Tile>
  )
}
