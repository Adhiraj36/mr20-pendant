// What the assistant may touch on this computer.
//
// The honest framing, which the copy here has to keep: restricting a place is
// a real block, and pointing it at a folder is not the opposite of that. A
// screen that said "it can only see these folders" would be lying, because the
// engine cannot promise that while the assistant still has a shell.
//
// So: two lists. The places it can never reach, which is the one with teeth
// and includes a standard set nobody has to think about. And the folders it
// works in, which is where you send it.
import { useEffect, useState, type ReactNode } from 'react'
import { FolderOpen, Lock, Plus, ShieldCheck, X } from 'lucide-react'
import type { AccessPolicy } from '@shared/types'
import { Button, Input, Panel, SectionHeader, Spinner, Toggle } from '@/components/ui'
import { useToast } from '@/components/Overlays'

export function AccessTab() {
  const toast = useToast()
  const [policy, setPolicy] = useState<AccessPolicy | null>(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<'grant' | 'deny' | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    void (async () => {
      const res = await window.karmax.api.get<AccessPolicy>('/api/access')
      setPolicy(res.ok ? (res.data ?? null) : null)
      setLoading(false)
    })()
  }, [])

  const put = async (next: AccessPolicy) => {
    // Sent whole rather than as one change at a time: this screen shows the
    // entire list, so sending back what is on it means the two cannot disagree
    // about what was just removed.
    const res = await window.karmax.api.request<AccessPolicy>('PUT', '/api/access', {
      enforced: next.enforced,
      grants: next.grants,
      deny: next.deny,
    })
    if (!res.ok) {
      toast(res.error ?? 'Could not save that.', 'bad')
      return
    }
    setPolicy(res.data ?? next)
  }

  if (loading) {
    return (
      <Panel>
        <Spinner />
      </Panel>
    )
  }
  if (!policy) {
    return (
      <Panel>
        <p className="text-[13px] text-[var(--fg-dim)]">
          Start the engine on the Dashboard page to set this.
        </p>
      </Panel>
    )
  }

  const add = async () => {
    const path = draft.trim()
    if (!path) return
    if (adding === 'deny') {
      await put({ ...policy, enforced: true, deny: [...policy.deny, path] })
    } else {
      await put({ ...policy, enforced: true, grants: [...policy.grants, { path, write: false }] })
    }
    setDraft('')
    setAdding(null)
  }

  const cancelAdd = () => {
    setAdding(null)
    setDraft('')
  }

  return (
    <>
      <Panel className="mb-4">
        <SectionHeader
          title="Limits"
          hint="Your assistant runs a coding agent on this computer, with real file and shell tools."
        />
        <Toggle
          label="Apply limits"
          hint={
            policy.enforced
              ? 'The places below are out of reach, including through the shell.'
              : 'No limits: it can reach anything you can. Turning this on also puts your keys and credentials out of reach.'
          }
          checked={policy.enforced}
          onChange={(v) => void put({ ...policy, enforced: v })}
        />
      </Panel>

      <Panel className="mb-4">
        <SectionHeader
          title="Never reachable"
          hint="A hard block. It covers the shell too, so `cat` on one of these is refused."
          action={
            <Button variant="ghost" icon={<Plus size={14} />} onClick={() => setAdding('deny')}>
              Add
            </Button>
          }
        />
        {adding === 'deny' && (
          <AddRow
            placeholder="/Users/you/Private"
            value={draft}
            onChange={setDraft}
            onAdd={add}
            onCancel={cancelAdd}
          />
        )}
        <div className="space-y-1">
          {policy.deny.map((path) => (
            <PathRow
              key={path}
              icon={<Lock size={13} />}
              path={path}
              onRemove={() => void put({ ...policy, deny: policy.deny.filter((d) => d !== path) })}
            />
          ))}
          {policy.standard.map((path) => (
            <PathRow key={path} icon={<ShieldCheck size={13} />} path={path} standard />
          ))}
        </div>
        <p className="mt-3 text-[12px] text-[var(--fg-dim)]">
          The greyed rows are always applied and cannot be removed — your keys, your credentials,
          the shared browser's profile, and LYZN's own store. They are listed so you can see they
          are covered.
        </p>
      </Panel>

      <Panel>
        <SectionHeader
          title="Works in"
          hint="Where you are sending it. This is an instruction rather than a fence — use the list above to put somewhere out of reach."
          action={
            <Button variant="ghost" icon={<Plus size={14} />} onClick={() => setAdding('grant')}>
              Add
            </Button>
          }
        />
        {adding === 'grant' && (
          <AddRow
            placeholder="/Users/you/Projects"
            value={draft}
            onChange={setDraft}
            onAdd={add}
            onCancel={cancelAdd}
          />
        )}
        {policy.grants.length === 0 ? (
          <p className="py-1 text-[13px] text-[var(--fg-dim)]">
            Nothing named yet. Add the folders you actually want it working in.
          </p>
        ) : (
          <div className="space-y-1">
            {policy.grants.map((g) => (
              <div
                key={g.path}
                className="flex items-center gap-2 rounded-[var(--radius)] px-2 py-1.5"
                style={{ background: 'var(--skin-1)' }}
              >
                <FolderOpen size={13} style={{ color: 'var(--fg-dim)', flexShrink: 0 }} />
                <span className="selectable flex-1 truncate font-mono text-[12px]">{g.path}</span>
                <button
                  className="text-[12px] text-[var(--fg-dim)] hover:text-[var(--fg)]"
                  onClick={() =>
                    void put({
                      ...policy,
                      grants: policy.grants.map((x) =>
                        x.path === g.path ? { ...x, write: !x.write } : x,
                      ),
                    })
                  }
                >
                  {g.write ? 'can change files' : 'read only'}
                </button>
                <button
                  className="text-[var(--fg-faint)] hover:text-[var(--bad)]"
                  onClick={() =>
                    void put({ ...policy, grants: policy.grants.filter((x) => x.path !== g.path) })
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  )
}

function AddRow({
  placeholder,
  value,
  onChange,
  onAdd,
  onCancel,
}: {
  placeholder: string
  value: string
  onChange: (v: string) => void
  onAdd: () => void
  onCancel: () => void
}) {
  return (
    <div className="mb-2 flex gap-2">
      <Input
        autoFocus
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onAdd()
          if (e.key === 'Escape') onCancel()
        }}
      />
      <Button onClick={onAdd}>Add</Button>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}

function PathRow({
  icon,
  path,
  standard,
  onRemove,
}: {
  icon: ReactNode
  path: string
  standard?: boolean
  onRemove?: () => void
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-[var(--radius)] px-2 py-1.5"
      style={{ background: standard ? 'transparent' : 'var(--skin-1)' }}
    >
      <span style={{ color: standard ? 'var(--fg-faint)' : 'var(--fg-dim)', flexShrink: 0 }}>
        {icon}
      </span>
      <span
        className="selectable flex-1 truncate font-mono text-[12px]"
        style={{ color: standard ? 'var(--fg-faint)' : undefined }}
      >
        {path}
      </span>
      {onRemove && (
        <button className="text-[var(--fg-faint)] hover:text-[var(--bad)]" onClick={onRemove}>
          <X size={14} />
        </button>
      )}
    </div>
  )
}
