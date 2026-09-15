// Writing a loop of your own: when it runs, and what it should do.
//
// The file underneath holds six-field cron expressions. Nobody is asked to
// type one: the editor offers the two shapes that cover almost everything —
// "every day at 08:30" and "every 2 hours" — and falls back to the raw
// expression only for a schedule it cannot describe.
import { useState } from 'react'
import type { Automation } from '@shared/types'
import { Button, Field, Input, Select, Textarea, Toggle } from '@/components/ui'
import { Modal } from '@/components/Overlays'
import { cronForDaily, parseDaily } from '@/lib/util'

type Mode = 'daily' | 'interval' | 'custom'

export function Editor({
  draft,
  previousName,
  onClose,
  onSaved,
}: {
  draft: Automation
  previousName?: string
  onClose: () => void
  onSaved: (next: Automation[]) => void
}) {
  const daily = parseDaily(draft.cron)
  const [mode, setMode] = useState<Mode>(draft.every ? 'interval' : daily ? 'daily' : 'custom')
  const [name, setName] = useState(draft.name)
  const [prompt, setPrompt] = useState(draft.prompt)
  const [hour, setHour] = useState(daily?.hour ?? 9)
  const [minute, setMinute] = useState(daily?.minute ?? 0)
  const [every, setEvery] = useState(draft.every || '2h')
  const [cron, setCron] = useState(draft.cron)
  const [direct, setDirect] = useState(Boolean(draft.harness))
  const [enabled, setEnabled] = useState(draft.enabled)
  const [busy, setBusy] = useState(false)
  // A blank field on a form nobody has typed in yet is not a mistake, so the
  // message waits until the field has been left.
  const [touched, setTouched] = useState(false)

  const nameProblem =
    name.trim() === ''
      ? 'Give it a name.'
      : !/^[a-z0-9][a-z0-9-]*$/.test(name.trim())
        ? 'Lowercase letters, numbers and hyphens only.'
        : null
  const nameError = touched ? nameProblem : null

  async function save() {
    setBusy(true)
    try {
      const next: Automation = {
        name: name.trim(),
        prompt: prompt.trim(),
        harness: direct ? 'claude_code' : '',
        enabled,
        cron: mode === 'daily' ? cronForDaily(hour, minute) : mode === 'custom' ? cron.trim() : '',
        every: mode === 'interval' ? every.trim() : '',
      }
      onSaved(await window.karmax.automations.save(next, previousName))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={previousName ? `Edit ${previousName}` : 'Write your own loop'}
      lede="Say when it should happen and what you want done. Everything else is up to the assistant."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!!nameProblem || prompt.trim() === ''}
            onClick={() => void save()}
          >
            Save
          </Button>
        </>
      }
    >
      <Field label="Name" hint="How you will refer to it. Lowercase, no spaces." error={nameError}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="morning-briefing"
          spellCheck={false}
        />
      </Field>

      <Field label="When">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            className="w-[168px]"
            value={mode}
            onChange={(v) => setMode(v as Mode)}
            options={[
              { value: 'daily', label: 'Every day at…' },
              { value: 'interval', label: 'Every so often' },
              { value: 'custom', label: 'A cron expression' },
            ]}
          />

          {mode === 'daily' && (
            <>
              <Select
                className="w-[92px]"
                value={String(hour)}
                onChange={(v) => setHour(Number(v))}
                options={Array.from({ length: 24 }, (_, h) => ({
                  value: String(h),
                  label: String(h).padStart(2, '0'),
                }))}
              />
              <span className="text-[var(--fg-faint)]">:</span>
              <Select
                className="w-[92px]"
                value={String(minute)}
                onChange={(v) => setMinute(Number(v))}
                options={[0, 15, 30, 45].map((m) => ({
                  value: String(m),
                  label: String(m).padStart(2, '0'),
                }))}
              />
            </>
          )}

          {mode === 'interval' && (
            <Select
              className="w-[168px]"
              value={every}
              onChange={setEvery}
              options={[
                { value: '15m', label: 'Every 15 minutes' },
                { value: '30m', label: 'Every 30 minutes' },
                { value: '1h', label: 'Every hour' },
                { value: '2h', label: 'Every 2 hours' },
                { value: '6h', label: 'Every 6 hours' },
                { value: '12h', label: 'Every 12 hours' },
                { value: '24h', label: 'Every day' },
              ]}
            />
          )}

          {mode === 'custom' && (
            <Input
              className="w-[240px]"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="0 30 8 * * *"
              spellCheck={false}
            />
          )}
        </div>
        {mode === 'custom' && (
          <span className="mt-1.5 block text-[12px] text-[var(--fg-faint)]">
            Six fields: second, minute, hour, day of month, month, day of week.
          </span>
        )}
      </Field>

      <Field label="What should it do?" hint="Written to the assistant, in your own words.">
        <Textarea
          rows={6}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Check my calendar for tomorrow and tell me if anything needs preparing."
        />
      </Field>

      <div className="mt-2 border-t">
        <Toggle
          checked={direct}
          onChange={setDirect}
          label="Send this straight to the coding assistant"
          hint="Skips the main model and saves the answer to memory. Best for research jobs that must keep working even when the main model is rate-limited."
        />
        <Toggle
          checked={enabled}
          onChange={setEnabled}
          label="Active"
          hint="Turn this off to keep the automation without running it."
        />
      </div>
    </Modal>
  )
}
