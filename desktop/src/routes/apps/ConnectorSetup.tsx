// Guided setup for any connector.
//
// Every field, every step and every callback URL on this screen comes from the
// daemon's own description of the connector. Nothing about GitHub or Notion is
// written here, which is what stops this file from rotting the moment KARMAX
// grows a connector it has never heard of.
import { useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink } from 'lucide-react'
import { Button, CopyButton, Field, Input, Mono, Textarea } from '@/components/ui'
import { Modal, useToast } from '@/components/Overlays'
import { cn } from '@/lib/util'

interface SetupStep {
  title: string
  body: string
  value?: string
  url?: string
  done?: boolean
}
interface SetupField {
  key: string
  label: string
  type: string
  placeholder?: string
  required: boolean
  method?: string
  description?: string
  help?: string
  set: boolean
  multiline?: boolean
}
interface SetupMethod {
  id: string
  name: string
  summary: string
  recommended: boolean
  steps: SetupStep[]
}
// The wire shape, and it is not the shape the types wished for: Go marshals a
// nil slice as JSON null, so a connector that offers one way in — which is
// every connector except GitHub — sends `"methods": null` rather than `[]`.
// Reading it as an array is what made this screen throw on open and take the
// window with it.
interface SetupDoc {
  id: string
  steps: SetupStep[] | null
  fields: SetupField[] | null
  callback_url: string
  redirect_uri: string
  methods: SetupMethod[] | null
  active_method: string
}

/** The document as the rest of this file wants it: every absent list is an
 *  empty one, so nothing below has to ask again. */
interface Setup extends Omit<SetupDoc, 'steps' | 'fields' | 'methods'> {
  steps: SetupStep[]
  fields: SetupField[]
  methods: SetupMethod[]
}

function usable(doc: SetupDoc): Setup {
  return {
    ...doc,
    steps: doc.steps ?? [],
    fields: doc.fields ?? [],
    methods: doc.methods ?? [],
  }
}

export function ConnectorSetup({
  id,
  name,
  open,
  onClose,
  onSaved,
}: {
  id: string
  name: string
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [doc, setDoc] = useState<Setup | null>(null)
  const [method, setMethod] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDoc(null)
    setValues({})
    setError(null)
    void window.karmax.console
      .request<SetupDoc>('GET', `/api/console/connectors/${encodeURIComponent(id)}/setup`)
      .then((res) => {
        if (!res.ok || !res.data) {
          setError(res.error ?? 'Could not load the setup instructions.')
          return
        }
        const ready = usable(res.data)
        setDoc(ready)
        setMethod(ready.active_method || ready.methods[0]?.id || '')
      })
  }, [open, id])

  const fields = (doc?.fields ?? []).filter((f) => !f.method || f.method === method)
  const chosen = doc?.methods.find((m) => m.id === method)
  const steps = chosen?.steps?.length ? chosen.steps : (doc?.steps ?? [])

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const payload: Record<string, string> = { ...values }
      if (method) payload.auth_method = method
      const res = await window.karmax.console.request(
        'POST',
        `/api/console/connectors/${encodeURIComponent(id)}/credentials`,
        payload,
      )
      if (!res.ok) {
        setError(res.error ?? 'That was not accepted.')
        return
      }
      // Check it straight away: saving a token that does not work and finding
      // out days later is the failure this whole screen exists to prevent.
      const health = await window.karmax.console.request<{ status: string; detail: string }>(
        'POST',
        `/api/console/connectors/${encodeURIComponent(id)}/health-check`,
      )
      if (health.ok && health.data?.status === 'healthy') {
        toast(`${name} is connected.`, 'ok')
      } else {
        toast(
          `Saved, but ${name} did not answer: ${health.data?.detail ?? health.error ?? 'unknown reason'}`,
          'bad',
        )
      }
      onSaved()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Connect ${name}`}
      lede="These instructions come from the engine itself, so they match the version you are running."
      wide
      footer={
        <>
          {error && <span className="mr-auto text-[12.5px] text-[var(--bad)]">{error}</span>}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void save()} disabled={!doc}>
            Save and test
          </Button>
        </>
      }
    >
      {!doc ? (
        <p className="text-[13px] text-[var(--fg-dim)]">Loading…</p>
      ) : (
        <>
          {doc.methods.length > 1 && (
            <div className="mb-5">
              <p className="mb-2 text-[13px] font-medium">How do you want to connect?</p>
              <div className="grid gap-2">
                {doc.methods.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMethod(m.id)}
                    className={cn(
                      ' border p-3.5 text-left transition duration-200',
                      method === m.id
                        ? 'border-[var(--accent)] bg-[var(--skin-2)]'
                        : 'bg-[var(--skin-1)] hover:border-[var(--edge-strong)]',
                    )}
                  >
                    <span className="flex items-center gap-2 text-[13.5px] font-medium">
                      {m.name}
                      {m.recommended && (
                        <span className="rounded-full bg-[var(--accent-glow)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--accent-bright)]">
                          easiest
                        </span>
                      )}
                    </span>
                    {m.summary && (
                      <span className="mt-0.5 block text-[12.5px] text-[var(--fg-dim)]">{m.summary}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(doc.redirect_uri || doc.callback_url) && (
            <div className="mb-5 border bg-[var(--skin-1)] p-4">
              <p className="text-[13px] font-medium">Register this address with {name}</p>
              <p className="mt-1 text-[12.5px] text-[var(--fg-dim)]">
                Skipping this is what makes a connection fail later with nothing to explain why.
              </p>
              {doc.redirect_uri && (
                <div className="mt-3 flex items-center gap-2">
                  <Mono className="min-w-0 flex-1 truncate">{doc.redirect_uri}</Mono>
                  <CopyButton value={doc.redirect_uri} />
                </div>
              )}
              {doc.callback_url && doc.callback_url !== doc.redirect_uri && (
                <div className="mt-2 flex items-center gap-2">
                  <Mono className="min-w-0 flex-1 truncate">{doc.callback_url}</Mono>
                  <CopyButton value={doc.callback_url} />
                </div>
              )}
            </div>
          )}

          {steps.length > 0 && (
            <ol className="mb-5 space-y-3">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span
                    className={cn(
                      'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
                      s.done
                        ? 'bg-[var(--ok-skin)] text-[var(--ok)]'
                        : 'bg-[var(--skin-3)] text-[var(--fg-dim)]',
                    )}
                  >
                    {s.done ? <CheckCircle2 size={13} /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium">{s.title}</span>
                    {s.body && (
                      <span className="mt-0.5 block text-[12.5px] leading-relaxed text-[var(--fg-dim)]">
                        {s.body}
                      </span>
                    )}
                    {s.value && (
                      <span className="mt-1.5 flex items-center gap-2">
                        <Mono className="min-w-0 truncate">{s.value}</Mono>
                        <CopyButton value={s.value} />
                      </span>
                    )}
                    {s.url && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-2"
                        icon={<ExternalLink size={13} />}
                        onClick={() => void window.karmax.app.openExternal(s.url!)}
                      >
                        Open
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}

          {fields.length > 0 && <div className="border-t pt-1" />}

          {fields.map((f) => (
            <Field
              key={f.key}
              label={f.label + (f.required ? '' : ' (optional)')}
              hint={[f.description, f.help].filter(Boolean).join(' · ') || undefined}
            >
              {f.multiline ? (
                <Textarea
                  rows={5}
                  spellCheck={false}
                  placeholder={f.set ? 'Already saved — leave blank to keep it' : f.placeholder}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              ) : (
                <Input
                  type={f.type === 'secret' ? 'password' : 'text'}
                  spellCheck={false}
                  placeholder={f.set ? 'Already saved — leave blank to keep it' : f.placeholder}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              )}
            </Field>
          ))}
        </>
      )}
    </Modal>
  )
}
