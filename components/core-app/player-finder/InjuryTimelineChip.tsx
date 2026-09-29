import type { InjuryTimeline } from '@/lib/core-app/injuryTimeline'

/**
 * Beside the readiness chip on a player's card: which way his designation is moving and ESPN's
 * estimated return (lib/core-app/injuryTimeline.ts) — "↑ from Out · ESPN est. return Oct 5". Every
 * width, since the header is what a phone shows. Free: facts, with the estimate labelled as ESPN's.
 */

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const fmt = (ymd: string) => DATE.format(new Date(`${ymd}T00:00:00Z`))

export function timelineParts(t: InjuryTimeline): { short: string[]; sentence: string } {
  const short: string[] = []
  const said: string[] = []
  if (t.previous) {
    const arrow = t.trend === 'up' ? '↑ ' : t.trend === 'down' ? '↓ ' : ''
    short.push(`${arrow}from ${t.previous.status}`)
    said.push(
      `${t.trend === 'up' ? 'Improved from' : t.trend === 'down' ? 'Worse than' : 'Was'} ${t.previous.status}, last reported ${fmt(t.previous.lastReported)}.`,
    )
  }
  if (t.estReturn) {
    short.push(`ESPN est. return ${fmt(t.estReturn)}`)
    said.push(`ESPN estimates a return on ${fmt(t.estReturn)}.`)
  }
  return { short, sentence: said.join(' ') }
}

export function InjuryTimelineChip({ timeline }: { timeline: InjuryTimeline | null | undefined }) {
  if (!timeline) return null
  const { short, sentence } = timelineParts(timeline)
  if (short.length === 0) return null
  return (
    <span className="af-chip af-num af-pf-injtl" data-trend={timeline.trend ?? 'none'} title={sentence}>
      <span aria-hidden="true">{short.join(' · ')}</span>
      <span className="af-pf-injtl-sr">{sentence}</span>
    </span>
  )
}
