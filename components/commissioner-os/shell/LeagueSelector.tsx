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
    /*
     * 🛑 `min-w-0` ON EVERY LINK IN THE CHAIN, OR `truncate` BELOW IS DEAD.
     * A flex item's `min-width` defaults to `auto` — its MIN-CONTENT width — so
     * without this the selector cannot shrink below the league name however
     * small the viewport, and the header row overflows instead. The span already
     * had `truncate`; it simply never got the chance to act.
     */
    <div className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="focus-ring flex min-h-11 min-w-0 items-center gap-1 rounded-[var(--radius-standard)] px-3 py-1.5 text-sm font-medium sm:min-h-0"
        style={{ background: 'var(--panel2)', color: 'var(--text)', border: '1px solid var(--border)' }}
      >
        {/*
          ⚠ THE CAP IS RESPONSIVE NOW. `max-w-[180px]` was a fixed 180px — nearly
          half a 390px phone for one label, beside four icon buttons in a row that
          could not wrap. Measured 206px wide on iPhone 12, contributing to a
          481px header in a 390px viewport.
        */}
        <span className="max-w-[110px] truncate sm:max-w-[180px]">{active?.name ?? 'Select league'}</span>
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
