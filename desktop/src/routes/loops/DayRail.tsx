// Today, as a rail: a tick for each time a loop goes, and a line for now.
//
// Ticks already passed are faint and the ones still to come are in ink, so a
// glance down the timetable says what has happened today and what is next.
import type { ReactNode } from 'react'
import { cn } from '@/lib/util'
import type { Schedule } from '@/routes/loops/schedule'

const at = (minute: number) => `${(minute / 1440) * 100}%`
const clock = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

export function HourRuler({ now, compact }: { now: Date; compact?: boolean }) {
  const minute = now.getHours() * 60 + now.getMinutes()
  // The chip is centred on now, except where that would push it past an end.
  const shift = minute < 90 ? '0%' : minute > 1350 ? '-100%' : '-50%'
  return (
    <div className="lz-ruler" aria-hidden="true">
      {(compact ? [0, 6, 12, 18] : [0, 3, 6, 9, 12, 15, 18, 21]).map((h) => (
        <span key={h} className="lz-ruler-hour" style={{ left: at(h * 60) }}>
          {String(h).padStart(2, '0')}
        </span>
      ))}
      <span className="lz-now" style={{ left: at(minute) }} />
      <span className="lz-now-chip" style={{ left: at(minute), transform: `translateX(${shift})` }}>
        {clock(now)}
      </span>
    </div>
  )
}

export function DayRail({ schedule, now, paused }: { schedule: Schedule; now: Date; paused?: boolean }) {
  const minute = now.getHours() * 60 + now.getMinutes()
  const off = schedule.kind === 'times' && !schedule.today
  let marks: ReactNode = null

  if (schedule.kind === 'event') {
    marks = <span className="lz-rail-event" />
  } else if (schedule.kind === 'every' || schedule.kind === 'times') {
    const ticks =
      schedule.kind === 'every'
        ? Array.from({ length: Math.max(1, Math.floor(1440 / schedule.minutes)) }, (_, i) => i * schedule.minutes)
        : schedule.minutes
    // Past sixty a tick each is a smear; a band says "all through here".
    if (ticks.length > 60) {
      const first = ticks[0]
      const last = ticks.at(-1)!
      marks = <span className="lz-rail-band" style={{ left: at(first), width: at(Math.max(last - first, 8)) }} />
    } else {
      marks = ticks.map((t) => (
        <span key={t} className={cn('lz-tick', !off && t < minute && 'lz-tick-past')} style={{ left: at(t) }} />
      ))
    }
  }

  return (
    <div className={cn('lz-rail', paused && 'lz-rail-paused', off && 'lz-rail-off')} aria-hidden="true">
      <span className="lz-rail-track" />
      {marks}
      <span className="lz-now" style={{ left: at(minute) }} />
    </div>
  )
}
