'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'
import type { CommsLeague } from './CommsDrawer'

export function LeagueScopePicker({ leagues, value, onChange, allowGlobal = false }: {
  leagues: CommsLeague[]; value: string | null; onChange: (id: string | null) => void; allowGlobal?: boolean
}) {
  const [query, setQuery] = useState('')
  const visible = leagues.filter(l => l.id === value || `${l.name} ${l.platform}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="af-cm-league-picker">
    <label className="af-cm-league-search"><Search size={16} aria-hidden /><input type="search" aria-label="Filter leagues" placeholder="Find a league" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <select aria-label="League scope" value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
      <option value="">{allowGlobal ? 'All leagues' : 'Select a league'}</option>
      {visible.map(l => <option key={l.id} value={l.id}>{l.name} ({l.platform})</option>)}
    </select>
  </div>
}
