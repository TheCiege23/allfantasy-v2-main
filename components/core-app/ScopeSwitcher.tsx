'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useOverlayContainment } from '@/components/core-app/useOverlayContainment'
import {
  FAVORITES_COOKIE,
  HOME_SCOPE_PARAM,
  platformLabel,
  SCOPE_COOKIE,
  scopeOptions,
  serializeFavoriteIds,
  type ScopeOption,
} from '@/lib/core-app/homeScope'
import '@/components/core-app/af-scope-switcher.css'

/**
 * The scope switcher — the one control that says, on every /core screen, which leagues you are
 * looking at, and changes it without leaving the page.
 *
 * WHY IT IS ALWAYS VISIBLE. Before this, the only place /core said "All leagues" was the header of
 * the phone's More sheet. On desktop the scope was implied by which rail tile was highlighted — and
 * with no tile highlighted, by nothing at all. A cross-league number with no stated scope reads as a
 * number about whatever league you last had in mind.
 *
 * WHAT IT CHANGES, AND WHERE IT TAKES YOU.
 *   - A FILTER (all, favorites, a sport, a platform) is a view of the home: it goes to `/core` with
 *     `?scope=`, and is remembered for the rest of the browser session (`SCOPE_COOKIE`, in
 *     lib/core-app/homeScope.ts — a server component cannot import a constant from here) so the Home
 *     link and the rail logo come back to it. "All leagues" clears it.
 *   - A LEAGUE keeps the screen you are on when that screen can show one league (the in-league
 *     tabs), and otherwise opens that league's home — the same destination as its rail tile.
 *
 * ⚠ THE STAR IS THIS DEVICE'S — see `FAVORITES_COOKIE` in lib/core-app/homeScope.ts. The switcher
 * says so, rather than letting someone star leagues on a phone and wonder where they went.
 */

export type ScopeSwitcherLeague = { id: string; name: string; platform: string; sport: string }

type Props = {
  leagues: ScopeSwitcherLeague[]
  /** The current scope's URL value (`fav`, `sport:NFL`, …) or null for all leagues. */
  scopeValue: string | null
  /** What the button says — `scopeLabel` on the server, so the first paint names the scope. */
  label: string
  selectedLeagueId: string | null
  favoriteIds: string[]
  /** Whether the current screen can be shown for a single league (it carries `?league=`). */
  leagueScreen: boolean
}

function writeCookie(name: string, value: string | null, maxAgeSeconds: number | null) {
  try {
    const secure = window.location.protocol === 'https:' ? '; secure' : ''
    if (value == null) {
      document.cookie = `${name}=; path=/; max-age=0; samesite=lax${secure}`
      return
    }
    const age = maxAgeSeconds == null ? '' : `; max-age=${maxAgeSeconds}`
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/${age}; samesite=lax${secure}`
  } catch {
    // Cookies blocked: the choice still applies to this navigation through the URL.
  }
}

export function ScopeSwitcher({ leagues, scopeValue, label, selectedLeagueId, favoriteIds, leagueScreen }: Props) {
  const router = useRouter()
  const pathname = usePathname() ?? '/core'
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set(favoriteIds))
  const panelRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelId = useId()
  const clickableRefs = useMemo(() => [scrimRef], [])

  // The server's list is the truth after every render; local edits only bridge the gap until then.
  const favoriteKey = favoriteIds.join('.')
  useEffect(() => {
    setFavorites(new Set(favoriteKey ? favoriteKey.split('.') : []))
  }, [favoriteKey])

  useOverlayContainment({
    active: open,
    containerRef: panelRef,
    onClose: () => setOpen(false),
    initialFocusRef: inputRef,
    keepClickableRefs: clickableRefs,
  })

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const options = useMemo(() => scopeOptions(leagues, favorites), [leagues, favorites])
  const q = query.trim().toLowerCase()
  const shownLeagues = useMemo(() => {
    const matched = q
      ? leagues.filter(
          (l) =>
            l.name.toLowerCase().includes(q) ||
            l.sport.toLowerCase() === q ||
            platformLabel(l.platform).toLowerCase().includes(q),
        )
      : leagues
    // Starred first, then the order the rail uses (by name) — stable within each group.
    return [...matched].sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)))
  }, [leagues, favorites, q])

  const filterHref = (value: string | null) =>
    value == null ? `/core?${HOME_SCOPE_PARAM}=all` : `/core?${HOME_SCOPE_PARAM}=${encodeURIComponent(value)}`

  const leagueHref = (id: string) => {
    const base = leagueScreen ? pathname : '/core'
    return `${base}?league=${encodeURIComponent(id)}`
  }

  const chooseFilter = (option: ScopeOption) => {
    writeCookie(SCOPE_COOKIE, option.value, null)
    setOpen(false)
  }

  const toggleFavorite = (id: string) => {
    const next = new Set(favorites)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setFavorites(next)
    writeCookie(FAVORITES_COOKIE, next.size ? serializeFavoriteIds(next) : null, 60 * 60 * 24 * 365)
    // The favorites view is the only one whose contents a star changes.
    if (scopeValue === 'fav' && !selectedLeagueId) router.refresh()
  }

  const groups: Array<{ key: ScopeOption['group']; title: string | null }> = [
    { key: 'all', title: null },
    { key: 'sport', title: 'Sport' },
    { key: 'platform', title: 'Platform' },
  ]

  const isCurrent = (option: ScopeOption) => !selectedLeagueId && option.value === scopeValue

  return (
    <div className="af-scope">
      <button
        type="button"
        className="af-scope-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-scoped={selectedLeagueId || scopeValue ? 'true' : 'false'}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="af-scope-kicker" aria-hidden="true">
          {selectedLeagueId ? 'League' : 'Viewing'}
        </span>
        <span className="af-scope-label">
          <span className="af-sr-only">Viewing: </span>
          {label}
        </span>
        <span className="af-scope-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <>
          <button
            ref={scrimRef}
            type="button"
            tabIndex={-1}
            className="af-scope-scrim"
            aria-label="Close league picker"
            onClick={() => setOpen(false)}
          />
          <div ref={panelRef} id={panelId} className="af-scope-panel" role="dialog" aria-modal="true" aria-label="Choose which leagues to view">
            <div className="af-scope-head">
              <strong>Which leagues?</strong>
              <button type="button" className="af-scope-close" aria-label="Close league picker" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>

            <div className="af-scope-filters">
              {groups.map((group) => {
                const inGroup = options.filter((o) =>
                  group.key === 'all' ? o.group === 'all' || o.group === 'favorites' : o.group === group.key,
                )
                if (inGroup.length === 0) return null
                return (
                  <div className="af-scope-group" key={group.key} role="group" aria-label={group.title ?? 'Scope'}>
                    {group.title ? <span className="af-scope-group-title">{group.title}</span> : null}
                    <div className="af-scope-chips">
                      {inGroup.map((option) => {
                        const disabled = option.group === 'favorites' && option.count === 0
                        return disabled ? (
                          <span key={option.label} className="af-scope-chip" aria-disabled="true" title="Star a league below to use this">
                            ★ Favorites <b>0</b>
                          </span>
                        ) : (
                          <Link
                            key={option.label}
                            href={filterHref(option.value)}
                            className="af-scope-chip"
                            aria-current={isCurrent(option) ? 'true' : undefined}
                            onClick={() => chooseFilter(option)}
                          >
                            {option.group === 'favorites' ? '★ ' : ''}
                            {option.label} <b>{option.count}</b>
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            <label className="af-scope-search">
              <span className="af-sr-only">Find a league</span>
              <input
                ref={inputRef}
                type="search"
                value={query}
                placeholder="Find a league, sport or platform"
                onChange={(event) => setQuery(event.target.value)}
                autoComplete="off"
              />
            </label>

            <ul className="af-scope-list" aria-label="Leagues">
              {shownLeagues.length === 0 ? (
                <li className="af-scope-empty">No league matches &ldquo;{query}&rdquo;.</li>
              ) : (
                shownLeagues.map((league) => {
                  const starred = favorites.has(league.id)
                  return (
                    <li key={league.id} className="af-scope-row" data-current={league.id === selectedLeagueId}>
                      <button
                        type="button"
                        className="af-scope-star"
                        aria-pressed={starred}
                        aria-label={`${starred ? 'Remove' : 'Add'} ${league.name} ${starred ? 'from' : 'to'} favorites`}
                        onClick={() => toggleFavorite(league.id)}
                      >
                        {starred ? '★' : '☆'}
                      </button>
                      <Link
                        href={leagueHref(league.id)}
                        className="af-scope-league"
                        aria-current={league.id === selectedLeagueId ? 'true' : undefined}
                        onClick={() => setOpen(false)}
                      >
                        <span className="af-scope-league-name">{league.name}</span>
                        <span className="af-scope-league-meta">
                          {league.sport} · {platformLabel(league.platform)}
                        </span>
                      </Link>
                    </li>
                  )
                })
              )}
            </ul>
            <p className="af-scope-note">Favorites are saved on this device.</p>
          </div>
        </>
      ) : null}
    </div>
  )
}

export default ScopeSwitcher
