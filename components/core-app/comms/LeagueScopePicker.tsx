'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { CommsLeague } from './CommsDrawer'
import { distinctLeagueLabels } from '@/lib/core-app/leagueNameCollision'

/**
 * The filter box earns its space only when the dropdown is long. It exists for the 60-league
 * account (the chips it replaced dropped every league past the sixth); beside a two-league
 * dropdown it was a half-width box reading "Find a lea" that filtered nothing.
 */
export const SEARCH_FROM_LEAGUES = 9

export function LeagueScopePicker({ leagues, value, onChange, allowGlobal = false }: {
  leagues: CommsLeague[]; value: string | null; onChange: (id: string | null) => void; allowGlobal?: boolean
}) {
  const [query, setQuery] = useState('')
  const showSearch = leagues.length >= SEARCH_FROM_LEAGUES
  /*
   * Two leagues sharing a name read as one option (measured 2026-09-28: two "…8-Team NFL Redraft
   * League (manual)" and four "…12-Team…" on one account). The app's one rule tells them apart.
   * Computed over every league this picker offers, not over the filtered `visible` subset, so an
   * option's label does not change under the reader as they type, and typing the suffix finds it.
   */
  const labels = useMemo(() => distinctLeagueLabels(leagues), [leagues])
  const labelOf = (l: CommsLeague) => labels.get(l.id) ?? l.name
  const visible = leagues.filter(l => l.id === value || `${labelOf(l)} ${l.platform}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="af-cm-league-picker" data-search={showSearch}>
    {showSearch ? <label className="af-cm-league-search"><Search size={16} aria-hidden /><input type="search" aria-label="Filter leagues" placeholder="Search" value={query} onChange={e => setQuery(e.target.value)} /></label> : null}
    <select aria-label="League scope" value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
      <option value="">{allowGlobal ? 'All leagues' : 'Select a league'}</option>
      {visible.map(l => <option key={l.id} value={l.id}>{labelOf(l)} ({l.platform})</option>)}
    </select>
  </div>
}
