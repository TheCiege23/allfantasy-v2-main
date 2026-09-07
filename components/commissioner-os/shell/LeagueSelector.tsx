'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { ACTIVE_LEAGUE_COOKIE_KEY } from '@/lib/commissioner-ui/activeLeague/constants'

export interface LeagueSelectorOption {
  id: string
  name: string
}

export interface LeagueSelectorProps {
  leagues: LeagueSelectorOption[]
  activeLeagueId: string | null
}

/**
 * Header league switcher. Persists the choice as a cookie the same way
 * `DataModeIndicator` persists data mode — `resolveActiveLeagueId()`
 * (server) reads it back and validates it against this same user's own
 * leagues, so a tampered cookie can never select someone else's league. A
 * full page reload on selection is deliberate, matching that same
 * component's reasoning: switching leagues is a rare, click-then-look
 * action, not something that needs instant client state.
 */
export function LeagueSelector({ leagues, activeLeagueId }: LeagueSelectorProps) {
  const [open, setOpen] = useState(false)
  const active = leagues.find((l) => l.id === activeLeagueId)

  if (leagues.length === 0) {
    return (
      <span
        className="flex items-center gap-1 rounded-[var(--radius-standard)] px-3 py-1.5 text-sm font-medium"
        style={{ color: 'var(--muted)' }}
      >
        No leagues
      </span>
    )
  }

  function selectLeague(id: string) {
    document.cookie = `${ACTIVE_LEAGUE_COOKIE_KEY}=${id}; path=/; max-age=31536000`
    setOpen(false)
    window.location.reload()
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="focus-ring flex items-center gap-1 rounded-[var(--radius-standard)] px-3 py-1.5 text-sm font-medium"
        style={{ background: 'var(--panel2)', color: 'var(--text)', border: '1px solid var(--border)' }}
      >
        <span className="max-w-[180px] truncate">{active?.name ?? 'Select league'}</span>
        <ChevronDown size={16} aria-hidden />
      </button>
      {open && (
        <>
          {/* Click-outside catcher, same pattern as other overlay dismissals in this shell. */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <ul
            role="listbox"
            aria-label="Select league"
            className="absolute left-0 top-full z-40 mt-1 max-h-80 w-64 overflow-y-auto rounded-[var(--radius-standard)] py-1 text-sm shadow-lg"
            style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}
          >
            {leagues.map((league) => (
              <li key={league.id} role="option" aria-selected={league.id === activeLeagueId}>
                <button
                  type="button"
                  onClick={() => selectLeague(league.id)}
                  className="focus-ring block w-full truncate px-3 py-2 text-left"
                  style={{
                    color: 'var(--text)',
                    background: league.id === activeLeagueId ? 'var(--panel2)' : 'transparent',
                  }}
                >
                  {league.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
