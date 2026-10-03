'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { nextWaiverRunMs, type WaiverSchedule } from '@/lib/core-app/waiverRunClock'

/**
 * Sort, filter and reveal for the cross-league Waivers board.
 *
 * ⚠ THE CARDS ARE RENDERED ON THE SERVER AND PASSED IN, KEYED BY LEAGUE. This component only decides
 * ORDER and VISIBILITY. Rendering the cards here would make every import under them part of the
 * client bundle — and a client component that reaches a server-only module through a barrel is how
 * `next build` has died in this repo before. It also keeps each card byte-identical to the
 * server-rendered one the tests pin.
 */

export type WaiversBoardListItem = {
  key: string
  gain: number
  leagueName: string
  position: string | null
  schedule: WaiverSchedule | null
}

type SortKey = 'gain' | 'deadline' | 'league'

const SORT_LABEL: Record<SortKey, string> = {
  gain: 'Biggest gain',
  deadline: 'Next waiver run',
  league: 'League A–Z',
}

export function WaiversBoardList({
  items,
  cards,
  initial = 10,
}: {
  items: WaiversBoardListItem[]
  cards: Record<string, ReactNode>
  initial?: number
}) {
  const [sort, setSort] = useState<SortKey>('gain')
  const [pos, setPos] = useState<string>('ALL')
  const [all, setAll] = useState(false)
  /* The clock is the client's: a deadline sort computed on the server would freeze in the cache. */
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => setNow(Date.now()), [])

  const positions = useMemo(
    () => [...new Set(items.map((i) => (i.position ?? '').toUpperCase()).filter(Boolean))].sort(),
    [items],
  )
  const hasSchedules = items.some((i) => i.schedule != null)

  const ordered = useMemo(() => {
    const list = items.filter((i) => pos === 'ALL' || (i.position ?? '').toUpperCase() === pos)
    const byGain = (a: WaiversBoardListItem, b: WaiversBoardListItem) => b.gain - a.gain
    if (sort === 'league') return [...list].sort((a, b) => a.leagueName.localeCompare(b.leagueName) || byGain(a, b))
    if (sort === 'deadline' && now != null) {
      /* A league with no published schedule sorts after every league that has one, never first. */
      const at = (i: WaiversBoardListItem) => (i.schedule ? nextWaiverRunMs(i.schedule, now) : null) ?? Infinity
      return [...list].sort((a, b) => at(a) - at(b) || byGain(a, b))
    }
    return [...list].sort(byGain)
  }, [items, pos, sort, now])

  const visible = all ? ordered : ordered.slice(0, initial)

  return (
    <div className="af-wvb" data-testid="waivers-board-list">
      {items.length > 1 ? (
        <div className="af-wvb-controls" role="group" aria-label="Sort and filter">
          <label className="af-wvb-sort">
            <span className="af-bd-k">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} data-testid="waivers-board-sort">
              {(Object.keys(SORT_LABEL) as SortKey[])
                /* Offering a deadline sort with no deadlines on file would reorder nothing and imply it had. */
                .filter((k) => k !== 'deadline' || hasSchedules)
                .map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABEL[k]}
                  </option>
                ))}
            </select>
          </label>
          {positions.length > 1 ? (
            <div className="af-wvb-pos" role="radiogroup" aria-label="Position of the add">
              {['ALL', ...positions].map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={pos === p}
                  className="af-wvb-chip"
                  data-active={pos === p ? 'true' : undefined}
                  onClick={() => setPos(p)}
                >
                  {p === 'ALL' ? 'All' : p}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {visible.length > 0 ? (
        <ul className="af-bd-cards af-bd-cards--rich af-bd-cards--waivers">
          {visible.map((i) => (
            <li key={i.key}>{cards[i.key]}</li>
          ))}
        </ul>
      ) : (
        <p className="af-bd-note">No {pos} add tops any of your wires.</p>
      )}

      {!all && ordered.length > visible.length ? (
        <button type="button" className="af-wvb-more" onClick={() => setAll(true)} data-testid="waivers-board-show-all">
          Show all {ordered.length} leagues
        </button>
      ) : null}
    </div>
  )
}

/**
 * Leagues whose waivers run in the next 24 hours — only those with a real, imported schedule.
 * Rendered after mount (it is "now"-relative); nothing at all when no league qualifies.
 */
export function WaiversDueSoon({
  leagues,
}: {
  leagues: Array<{ key: string; leagueName: string; href: string; schedule: WaiverSchedule }>
}) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  if (now == null) return null
  const due = leagues
    .map((l) => ({ ...l, at: nextWaiverRunMs(l.schedule, now) }))
    .filter((l): l is typeof l & { at: number } => l.at != null && l.at - now <= 24 * 3_600_000)
    .sort((a, b) => a.at - b.at)
  if (due.length === 0) return null
  const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  return (
    <section className="af-wvb-due" aria-label="Waivers processing in the next 24 hours" data-testid="waivers-due-soon">
      <span className="af-bd-k">Processing in the next 24 hours</span>
      <ul>
        {due.map((l) => {
          const mins = Math.max(0, Math.round((l.at - now) / 60_000))
          return (
            <li key={l.key}>
              <a href={l.href}>{l.leagueName}</a>{' '}
              <span className="af-wvb-due-at">
                {fmt.format(new Date(l.at))} · in {mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
