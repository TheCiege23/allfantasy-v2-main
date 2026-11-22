'use client'

import { useEffect, useMemo, useState } from 'react'
import type { LeagueMove, LeagueMovePlayer } from '@/lib/league-chat/leagueMoves'
import { POSITION_COLORS } from '@/lib/league-labels/catalog'

/**
 * The league's Activity tab: every completed move in the last 30 days — trades (both sides),
 * waiver claims with their bid, free-agent adds and drops — newest first, filterable by kind.
 *
 * Reads `/api/app/leagues/[leagueId]/chat/moves` (Postgres only, the same feed league chat draws its
 * move cards from), never the provider. Colours come from the league type's skin (`--lsk-*`).
 */
type Filter = 'all' | 'trade' | 'waiver' | 'roster_move'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'trade', label: 'Trades' },
  { id: 'waiver', label: 'Waivers' },
  { id: 'roster_move', label: 'Free agents' },
]
const KIND_LABEL: Record<LeagueMove['kind'], string> = { trade: 'Trade · Completed', waiver: 'Waiver claim', roster_move: 'Free agent' }

const T = {
  text: 'var(--lsk-text, #fff)',
  text2: 'var(--lsk-text2, rgba(255,255,255,.8))',
  muted: 'var(--lsk-muted, rgba(255,255,255,.6))',
  line: 'var(--lsk-line, rgba(255,255,255,.1))',
  surface: 'var(--lsk-surface, #0e1119)',
  surface2: 'var(--lsk-surface2, #1a1f2b)',
}

function groupLabel(iso: string, now: number): string {
  const days = (now - new Date(iso).getTime()) / 86_400_000
  if (days < 7) return 'This week'
  if (days < 14) return 'Last week'
  return 'Earlier this month'
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function PosChip({ pos }: { pos: string | null }) {
  const c = pos ? POSITION_COLORS[pos.toUpperCase()] : undefined
  return (
    <span
      className="inline-flex h-[26px] min-w-[38px] shrink-0 items-center justify-center rounded-md px-1 text-[11px] font-extrabold"
      style={c ? { background: c.fill, color: c.text } : { background: T.surface2, color: T.text2 }}
    >
      {pos ?? '—'}
    </span>
  )
}

function PlayerLine({ p, kind }: { p: LeagueMovePlayer; kind?: 'ADD' | 'DROP' }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-3 py-2" style={{ background: T.surface2 }}>
      {kind ? (
        <span className="w-11 shrink-0 text-[12px] font-extrabold tracking-wide" style={{ color: kind === 'ADD' ? '#34d399' : '#fb7185' }}>
          {kind}
        </span>
      ) : null}
      <PosChip pos={p.position} />
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-bold" style={{ color: T.text }}>{p.name}</span>
        <span className="block text-[12px]" style={{ color: T.muted }}>{[p.position, p.team].filter(Boolean).join(' · ') || '—'}</span>
      </span>
    </div>
  )
}

function TradeSides({ move }: { move: LeagueMove }) {
  // Group what each team RECEIVED by the add's `to`; an add whose receiver is unknown is shown under "Moved".
  const sides = new Map<string, LeagueMovePlayer[]>()
  for (const a of move.adds) {
    const key = a.to ?? 'Moved'
    sides.set(key, [...(sides.get(key) ?? []), a])
  }
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
      {[...sides.entries()].map(([team, players]) => (
        <div key={team} className="flex flex-col gap-2 rounded-xl p-3" style={{ background: T.surface2 }}>
          <span className="text-[12px] font-bold uppercase tracking-[0.08em]" style={{ color: T.muted }}>
            {team === 'Moved' ? 'Moved' : `${team} receives`}
          </span>
          {players.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5">
              <PosChip pos={p.position} />
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-bold" style={{ color: T.text }}>{p.name}</span>
                <span className="block text-[12px]" style={{ color: T.muted }}>{[p.position, p.team].filter(Boolean).join(' · ')}</span>
              </span>
            </div>
          ))}
        </div>
      ))}
      {move.picks.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-xl p-3" style={{ background: T.surface2 }}>
          <span className="text-[12px] font-bold uppercase tracking-[0.08em]" style={{ color: T.muted }}>Picks</span>
          {move.picks.map((pk) => (
            <span key={pk} className="text-[14px] font-bold" style={{ color: T.text }}>{pk}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function LeagueActivityTab({ leagueId }: { leagueId: string }) {
  const [moves, setMoves] = useState<LeagueMove[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    let cancelled = false
    setMoves(null)
    setFailed(false)
    fetch(`/api/app/leagues/${encodeURIComponent(leagueId)}/chat/moves`, { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json: { moves?: LeagueMove[] }) => {
        if (!cancelled) setMoves(Array.isArray(json.moves) ? json.moves : [])
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  const groups = useMemo(() => {
    const shown = (moves ?? []).filter((m) => filter === 'all' || m.kind === filter)
    const now = Date.now()
    const out: { title: string; items: LeagueMove[] }[] = []
    for (const m of shown) {
      const title = groupLabel(m.occurredAt, now)
      const g = out.find((x) => x.title === title)
      if (g) g.items.push(m)
      else out.push({ title, items: [m] })
    }
    return out
  }, [moves, filter])

  const count = (f: Filter) => (moves ?? []).filter((m) => f === 'all' || m.kind === f).length

  return (
    <section className="flex flex-col gap-4 px-4 py-5 sm:px-5" aria-labelledby="league-activity-title" data-testid="league-activity-tab">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="league-activity-title" className="m-0 text-[24px] font-extrabold" style={{ color: T.text }}>Activity</h2>
        <span className="text-[14px]" style={{ color: T.muted }}>Every completed move in the last 30 days, newest first</span>
      </div>

      <div role="group" aria-label="Filter activity" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const on = filter === f.id
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(f.id)}
              className="min-h-[40px] rounded-full border px-4 text-[14px] font-bold"
              style={
                on
                  ? { background: 'var(--lsk-accent-strong, #3ddc84)', color: 'var(--lsk-accent-ink, #06070f)', borderColor: 'var(--lsk-accent-strong, #3ddc84)' }
                  : { background: 'transparent', color: T.text2, borderColor: T.line }
              }
            >
              {f.label} <span className="opacity-75">{moves ? count(f.id) : ''}</span>
            </button>
          )
        })}
      </div>

      {failed ? (
        <p className="rounded-xl border px-4 py-6 text-center text-[14px]" style={{ borderColor: T.line, color: T.muted }}>
          We couldn&apos;t load this league&apos;s activity. Try again shortly.
        </p>
      ) : moves == null ? (
        <div className="h-24 animate-pulse rounded-xl" style={{ background: T.surface }} />
      ) : groups.length === 0 ? (
        <p className="rounded-xl border px-4 py-6 text-center text-[14px]" style={{ borderColor: T.line, color: T.muted }}>
          {filter === 'all' ? 'No moves in the last 30 days.' : 'No moves of this kind in the last 30 days.'}
        </p>
      ) : (
        groups.map((g) => (
          <div key={g.title} className="flex flex-col gap-2.5">
            <h3 className="m-0 mt-1 text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: T.muted }}>{g.title}</h3>
            {g.items.map((m) => {
              const tagColor = m.kind === 'trade' ? 'var(--af-blue, #3b82f6)' : 'var(--lsk-accent, #3ddc84)'
              const who = m.kind === 'trade' && m.involvedTeams.length > 1 ? m.involvedTeams.join(' ⇄ ') : m.teamName ?? m.managerName ?? 'A manager'
              return (
                <article key={m.id} className="flex flex-col gap-3 rounded-2xl border p-4" style={{ borderColor: T.line, background: T.surface }} data-testid="league-activity-item">
                  <div className="flex items-center gap-3">
                    {m.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold" style={{ background: T.surface2, color: T.muted }}>
                        {(who || '?').slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-bold" style={{ color: T.text }}>{who}</span>
                      <span className="block text-[13px]" style={{ color: T.muted }}>
                        {when(m.occurredAt)}
                        {m.bid != null ? ` · $${m.bid} bid` : ''}
                      </span>
                    </span>
                    <span className="ml-auto shrink-0 rounded-full border px-2.5 py-1 text-[12px] font-bold" style={{ borderColor: tagColor, color: tagColor }}>
                      {KIND_LABEL[m.kind]}
                    </span>
                  </div>
                  {m.kind === 'trade' ? (
                    <TradeSides move={m} />
                  ) : (
                    <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                      {m.adds.map((p) => <PlayerLine key={`a${p.id}`} p={p} kind="ADD" />)}
                      {m.drops.map((p) => <PlayerLine key={`d${p.id}`} p={p} kind="DROP" />)}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        ))
      )}
    </section>
  )
}
