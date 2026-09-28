'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'
import type { CommsLeague } from './CommsDrawer'

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
  const visible = leagues.filter(l => l.id === value || `${l.name} ${l.platform}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="af-cm-league-picker" data-search={showSearch}>
    {showSearch ? <label className="af-cm-league-search"><Search size={16} aria-hidden /><input type="search" aria-label="Filter leagues" placeholder="Search" value={query} onChange={e => setQuery(e.target.value)} /></label> : null}
    <select aria-label="League scope" value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
      <option value="">{allowGlobal ? 'All leagues' : 'Select a league'}</option>
      {visible.map(l => <option key={l.id} value={l.id}>{l.name} ({l.platform})</option>)}
    </select>
  </div>
}
