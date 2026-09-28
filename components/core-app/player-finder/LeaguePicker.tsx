'use client'

import { useMemo, useState } from 'react'

import { platformLabel } from '@/lib/core-app/platformLinks'

/**
 * "Leagues: All 65 ▾" — pick which leagues the Player Finder reads (Phase 2, 2026-09-27).
 *
 * The dynastyplanet control: every league, or only the ones you tick. The choice is saved to the
 * ACCOUNT (POST /api/core/players/leagues), then the page reloads and every list on it — game-day
 * starters, your shares, the leagues on a player's card — reads the picked set.
 *
 * A plain reload rather than the app router: this also renders in tests with no router mounted.
 */

type PickLeague = { id: string; name: string; platform: string | null }

export function LeaguePicker({
  leagues,
  saved,
}: {
  leagues: PickLeague[]
  /** The account's saved pick, already intersected with `leagues`; null = all. */
  saved: string[] | null
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(saved ?? leagues.map((l) => l.id)))
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle')

  const total = leagues.length
  const current = saved ? saved.length : total
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? leagues.filter((l) => l.name.toLowerCase().includes(q) || platformLabel(l.platform).toLowerCase().includes(q)) : leagues
  }, [filter, leagues])

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const save = async () => {
    setState('saving')
    const all = chosen.size === 0 || chosen.size === total
    try {
      const res = await fetch('/api/core/players/leagues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leagueIds: all ? null : [...chosen] }),
      })
      if (!res.ok) throw new Error(String(res.status))
      window.location.reload()
    } catch {
      setState('error')
    }
  }

  if (total < 2) return null

  return (
    <div className="af-pf-picker" data-open={open ? 'true' : undefined}>
      <button type="button" className="af-pf-picker-btn" aria-expanded={open} aria-controls="af-pf-picker-panel" onClick={() => setOpen((o) => !o)}>
        <span className="af-label">Leagues</span>
        <span className="af-num">{current === total ? `All ${total}` : `${current} of ${total}`}</span>
        <span aria-hidden>▾</span>
      </button>
      {open ? (
        <div className="af-pf-picker-panel" id="af-pf-picker-panel" role="group" aria-label="Pick the leagues the Player Finder reads">
          <div className="af-pf-picker-tools">
            <input
              type="search"
              className="af-pf-picker-filter"
              placeholder="Filter leagues"
              aria-label="Filter leagues"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <button type="button" className="af-pf-picker-mini" onClick={() => setChosen(new Set(leagues.map((l) => l.id)))}>
              All
            </button>
            <button type="button" className="af-pf-picker-mini" onClick={() => setChosen(new Set())}>
              None
            </button>
          </div>
          <ul className="af-pf-picker-list">
            {shown.map((l) => (
              <li key={l.id}>
                <label className="af-pf-picker-row">
                  <input type="checkbox" checked={chosen.has(l.id)} onChange={() => toggle(l.id)} />
                  <span className="af-pf-picker-name">{l.name}</span>
                  <span className="af-pf-picker-where">{platformLabel(l.platform)}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="af-pf-picker-foot">
            <span className="af-num">{chosen.size === 0 || chosen.size === total ? `All ${total}` : `${chosen.size} of ${total}`} selected</span>
            <button type="button" className="af-pf-picker-save" onClick={save} disabled={state === 'saving'}>
              {state === 'saving' ? 'Saving…' : 'Save'}
            </button>
          </div>
          {state === 'error' ? (
            <p className="af-pf-picker-error" role="status">
              Could not save — try again.
            </p>
          ) : null}
          <p className="af-pf-picker-note">Saved to your account, so the same leagues show on every device. None ticked means all.</p>
        </div>
      ) : null}
    </div>
  )
}

export default LeaguePicker
