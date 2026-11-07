'use client'

/**
 * History tab: the house log as sentences, newest week first ("Floater Nation was evicted").
 *
 * It reads `entries` — the PUBLIC log the audit route builds with `publicHouseLog` — never the raw audit rows. Until
 * 2026-11-07 this panel printed each row's event name and metadata as JSON, which put the per-nominee eviction tally
 * (hidden by default) and roster snapshots in front of every houseguest. Names come from the summary the parent has
 * already loaded.
 */
import { useEffect, useMemo, useState } from 'react'
import { houseLogLine, type HouseLogKind, type PublicHouseLogEntry } from '@/lib/big-brother/houseLogLine'

const DOT: Record<HouseLogKind, string> = {
  season_start: 'bg-white/40',
  phase: 'bg-white/30',
  hoh: 'bg-amber-300',
  nominations: 'bg-rose-400',
  replacement: 'bg-rose-400',
  veto: 'bg-emerald-300',
  have_nots: 'bg-sky-300',
  eviction: 'bg-rose-500',
  jury: 'bg-violet-300',
  finale: 'bg-amber-300',
}

const STRONG: ReadonlySet<HouseLogKind> = new Set(['hoh', 'veto', 'eviction', 'finale'])

export function BigBrotherHistoryPanel({ leagueId, names = {} }: { leagueId: string; names?: Record<string, string> }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [entries, setEntries] = useState<PublicHouseLogEntry[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/big-brother/audit?limit=80`, { cache: 'no-store' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (!cancelled) setError(data.error ?? `Error ${res.status}`)
          return
        }
        if (!cancelled) setEntries(Array.isArray(data.entries) ? data.entries : [])
      } catch {
        if (!cancelled) setError('Failed to load history')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leagueId])

  const weeks = useMemo(() => {
    const byWeek = new Map<string, PublicHouseLogEntry[]>()
    for (const e of entries) {
      const k = e.week == null ? '—' : String(e.week)
      byWeek.set(k, [...(byWeek.get(k) ?? []), e])
    }
    return [...byWeek.entries()].sort((a, b) => Number(b[0]) - Number(a[0]))
  }, [entries])

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-white/60" data-testid="bb-history">
        Loading the house log…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-500/25 bg-amber-950/15 p-4 text-sm text-amber-200/90" data-testid="bb-history">
        {error}
      </div>
    )
  }

  const name = (id: string) => names[id]

  return (
    <section
      className="space-y-4 rounded-2xl border border-cyan-500/15 bg-gradient-to-b from-[#0c1428]/95 to-[#050814] p-4 sm:p-5"
      data-testid="bb-history"
      aria-label="House log"
    >
      <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200/75">House log</h3>
      {weeks.length === 0 ? (
        <p className="text-sm text-white/50">Nothing has happened in the house yet.</p>
      ) : (
        weeks.map(([week, rows]) => (
          <div key={week}>
            <h4 className="mb-2 text-[13px] font-semibold text-white/85">{week === '—' ? 'Season' : `Week ${week}`}</h4>
            <ol className="space-y-1.5 border-l border-white/10 pl-4">
              {rows.map((e, i) => (
                <li key={`${e.at}-${i}`} className="relative flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[14px] leading-snug">
                  <span aria-hidden className={`absolute -left-[21px] top-[7px] h-2 w-2 rounded-full ${DOT[e.kind]}`} />
                  <span className={STRONG.has(e.kind) ? 'font-medium text-white/95' : 'text-white/70'}>{houseLogLine(e, name)}</span>
                  <time className="shrink-0 text-[12px] text-white/45" dateTime={e.at}>
                    {new Date(e.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </time>
                </li>
              ))}
            </ol>
          </div>
        ))
      )}
    </section>
  )
}
