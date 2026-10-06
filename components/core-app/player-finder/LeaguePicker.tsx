'use client'

import { useMemo, useState } from 'react'

import { distinctLeagueLabels } from '@/lib/core-app/leagueNameCollision'
import { platformLabel } from '@/lib/core-app/platformLinks'
import { pickerCopy } from '@/lib/core-app/finderSearchCopy'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * "Leagues: All 65 ▾" — pick which leagues the Player Finder reads (Phase 2, 2026-09-27).
 *
 * The dynastyplanet control: every league, or only the ones you tick. The choice is saved to the
 * ACCOUNT (POST /api/core/players/leagues), then the page reloads and every list on it — game-day
 * starters, your shares, the leagues on a player's card — reads the picked set.
 *
 * A plain reload rather than the app router: this also renders in tests with no router mounted.
 *
 * Spanish (2026-10-05): the words are built at render from `useOptionalLanguage` (finderSearchCopy.ts).
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
  const { language } = useOptionalLanguage()
  const t = pickerCopy(language)
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(saved ?? leagues.map((l) => l.id)))
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle')

  const total = leagues.length
  const current = saved ? saved.length : total
  /*
   * Same-named leagues are told apart by the app's one rule (lib/core-app/leagueNameCollision.ts) —
   * a tick list of four identical "…12-Team NFL Redraft League (manual)" rows (measured 2026-09-28)
   * cannot be ticked on purpose. Once over the whole list, so a label does not change as you filter.
   */
  const labels = useMemo(() => distinctLeagueLabels(leagues), [leagues])
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? leagues.filter((l) => (labels.get(l.id) ?? l.name).toLowerCase().includes(q) || platformLabel(l.platform).toLowerCase().includes(q)) : leagues
  }, [filter, leagues, labels])

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
        <span className="af-label">{t.leagues}</span>
        <span className="af-num">{t.count(current, total)}</span>
        <span aria-hidden>▾</span>
      </button>
      {open ? (
        <div className="af-pf-picker-panel" id="af-pf-picker-panel" role="group" aria-label={t.panelLabel}>
          <div className="af-pf-picker-tools">
            <input
              type="search"
              className="af-pf-picker-filter"
              placeholder={t.filter}
              aria-label={t.filter}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <button type="button" className="af-pf-picker-mini" onClick={() => setChosen(new Set(leagues.map((l) => l.id)))}>
              {t.all}
            </button>
            <button type="button" className="af-pf-picker-mini" onClick={() => setChosen(new Set())}>
              {t.none}
            </button>
          </div>
          <ul className="af-pf-picker-list">
            {shown.map((l) => (
              <li key={l.id}>
                <label className="af-pf-picker-row">
                  <input type="checkbox" checked={chosen.has(l.id)} onChange={() => toggle(l.id)} />
                  <span className="af-pf-picker-name">{labels.get(l.id) ?? l.name}</span>
                  <span className="af-pf-picker-where">{platformLabel(l.platform)}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="af-pf-picker-foot">
            <span className="af-num">{t.selected(chosen.size === 0 ? total : chosen.size, total)}</span>
            <button type="button" className="af-pf-picker-save" onClick={save} disabled={state === 'saving'}>
              {state === 'saving' ? t.saving : t.save}
            </button>
          </div>
          {state === 'error' ? (
            <p className="af-pf-picker-error" role="status">
              {t.error}
            </p>
          ) : null}
          <p className="af-pf-picker-note">{t.note}</p>
        </div>
      ) : null}
    </div>
  )
}

export default LeaguePicker
