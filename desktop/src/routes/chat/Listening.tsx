import { useEffect, useState } from 'react'

/** The composer's toolbar while it listens: how loud, and for how long. */
export function Listening({ levels, startedAt, finishing }: { levels: number[]; startedAt: number; finishing: boolean }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])
  const secs = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 pl-2" aria-live="polite">
      <span className="w-[62px] shrink-0 font-mono text-[10px] text-[var(--accent)]">
        {finishing ? 'Finishing' : startedAt ? 'Listening' : 'Starting'}
      </span>
      <span className="flex h-5 items-center gap-[2px]" aria-hidden="true">
        {levels.map((v, i) => (
          <span
            key={i}
            className="w-[2px] bg-[var(--accent)] transition-[height] duration-100"
            style={{ height: `${Math.max(2, Math.round(v * 20))}px`, opacity: 0.3 + v * 0.7 }}
          />
        ))}
      </span>
      <span className="font-mono text-[10px] tabular-nums text-[var(--fg-faint)]">
        {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
      </span>
      <span className="ml-auto truncate font-mono text-[10px] text-[var(--fg-faint)]">Esc to discard</span>
    </div>
  )
}
