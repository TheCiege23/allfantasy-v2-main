'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useOverlayContainment } from '@/components/core-app/useOverlayContainment'
import { CommissionerBadge } from '@/components/core-app/CommissionerBadge'
import {
  FAVORITES_COOKIE,
  HOME_SCOPE_PARAM,
  platformLabel,
  SCOPE_COOKIE,
  scopeOptions,
  serializeFavoriteIds,
  type ScopeOption,
} from '@/lib/core-app/homeScope'
import { distinctLeagueLabels } from '@/lib/core-app/leagueNameCollision'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { scopeLabelText } from '@/lib/core-app/shellCopy'
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

/**
 * "Show all leagues" outside the switcher — the filtered home's note and its empty panel.
 *
 * ⚠ IT MUST CLEAR THE REMEMBERED FILTER, NOT ONLY NAVIGATE. `?scope=all` shows every league for
 * that one render, but the session cookie still names the old filter, so the very next tap on Home
 * (a bare `/core`) put it straight back. A server component cannot write the cookie, so the link
 * is a client component that does, on the click.
 */
export function ScopeResetLink({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Link href={`/core?${HOME_SCOPE_PARAM}=all`} className={className} onClick={() => writeCookie(SCOPE_COOKIE, null, null)}>
      {children}
    </Link>
  )
}

export type ScopeSwitcherLeague = {
  id: string
  name: string
  platform: string
  sport: string
  /** The viewer commissions it — draws the blue C (CommissionerBadge). */
  isCommissioner?: boolean
}

type Props = {
  leagues: ScopeSwitcherLeague[]
  /** The current scope's URL value (`fav`, `sport:NFL`, …) or null for all leagues. */
  scopeValue: string | null
  /** What the button says — `scopeLabel` on the server, so the first paint names the scope. */
  label: string
  selectedLeagueId: string | null
  favoriteIds: string[]
  /**
   * Whether the current screen is one of the in-league tabs (lib/core-app/leagueScreens.ts). Only
   * then does picking a league keep you on it; a cross-league screen sends you to the league's home.
   */
  leagueScreen: boolean
  /**
   * Leagues the account hid from its lists (lib/core-app/leaguePreferences.ts). Left out of the
   * league list below — but NOT out of the filter counts, which describe what each filter shows on
   * Home, where a hidden league still counts. Searching still finds one, and the open league always
   * shows.
   */
  hiddenIds?: string[]
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

export function ScopeSwitcher({ leagues, scopeValue, label, selectedLeagueId, favoriteIds, leagueScreen, hiddenIds = [] }: Props) {
  const router = useRouter()
  const pathname = usePathname() ?? '/core'
  /*
   * The switcher's words in the reader's language (2026-10-03) — it sits in the top bar of every /core
   * screen, and a live Spanish check found all of it in English. A league's OWN name is never
   * translated: `label` is only passed through `scopeLabelText` when no league is selected.
   */
  const { language } = useOptionalLanguage()
  const es = language === 'es'
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
  /*
   * Same-named leagues get the app's one disambiguation rule (lib/core-app/leagueNameCollision.ts):
   * measured 2026-09-28, one account's list held four identical "…12-Team NFL Redraft League
   * (manual)" rows. Computed once over the whole list, not the search-filtered one, so a row's
   * label never changes as the reader types.
   */
  const labels = useMemo(() => distinctLeagueLabels(leagues), [leagues])
  const labelOf = (l: ScopeSwitcherLeague) => labels.get(l.id) ?? l.name
  const q = query.trim().toLowerCase()
  const hiddenKey = hiddenIds.join('.')
  const shownLeagues = useMemo(() => {
    const hidden = new Set(hiddenKey ? hiddenKey.split('.') : [])
    const matched = q
      ? leagues.filter(
          (l) =>
            (labels.get(l.id) ?? l.name).toLowerCase().includes(q) ||
            l.sport.toLowerCase() === q ||
            platformLabel(l.platform).toLowerCase().includes(q),
        )
      : leagues.filter((l) => !hidden.has(l.id) || l.id === selectedLeagueId)
    // Starred first, then the order the rail uses (by name) — stable within each group.
    return [...matched].sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)))
  }, [leagues, labels, favorites, q, hiddenKey, selectedLeagueId])

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
    /*
     * And to the account, so a star follows the manager to another device (2026-10-02). The cookie
     * stays as this device's fallback until a first save exists; the server list wins after that.
     * Fire-and-forget: a failed save leaves the cookie, which is exactly the old behaviour.
     */
    void fetch('/api/core/league-preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field: 'favorites', leagueIds: [...next] }),
    }).catch(() => undefined)
    // The favorites view is the only one whose contents a star changes.
    if (scopeValue === 'fav' && !selectedLeagueId) router.refresh()
  }

  const groups: Array<{ key: ScopeOption['group']; title: string | null }> = [
    { key: 'all', title: null },
    { key: 'sport', title: es ? 'Deporte' : 'Sport' },
    { key: 'platform', title: es ? 'Plataforma' : 'Platform' },
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
          {selectedLeagueId ? (es ? 'Liga' : 'League') : es ? 'Viendo' : 'Viewing'}
        </span>
        <span className="af-scope-label">
          <span className="af-sr-only">{es ? 'Viendo: ' : 'Viewing: '}</span>
          {selectedLeagueId ? label : scopeLabelText(label, language)}
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
            aria-label={es ? 'Cerrar el selector de ligas' : 'Close league picker'}
            onClick={() => setOpen(false)}
          />
          <div ref={panelRef} id={panelId} className="af-scope-panel" role="dialog" aria-modal="true" aria-label={es ? 'Elige qué ligas ver' : 'Choose which leagues to view'}>
            <div className="af-scope-head">
              <strong>{es ? '¿Qué ligas?' : 'Which leagues?'}</strong>
              <button type="button" className="af-scope-close" aria-label={es ? 'Cerrar el selector de ligas' : 'Close league picker'} onClick={() => setOpen(false)}>
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
                  <div className="af-scope-group" key={group.key} role="group" aria-label={group.title ?? (es ? 'Alcance' : 'Scope')}>
                    {group.title ? <span className="af-scope-group-title">{group.title}</span> : null}
                    <div className="af-scope-chips">
                      {inGroup.map((option) => {
                        const disabled = option.group === 'favorites' && option.count === 0
                        const key = option.value ?? 'all'
                        return disabled ? (
                          <span
                            key={key}
                            className="af-scope-chip"
                            aria-disabled="true"
                            title={es ? 'Marca una liga con la estrella para usar esto' : 'Star a league below to use this'}
                          >
                            ★ {es ? 'Favoritas' : 'Favorites'} <b>0</b>
                          </span>
                        ) : (
                          <Link
                            key={key}
                            href={filterHref(option.value)}
                            className="af-scope-chip"
                            aria-current={isCurrent(option) ? 'true' : undefined}
                            onClick={() => chooseFilter(option)}
                          >
                            {option.group === 'favorites' ? '★ ' : ''}
                            {scopeLabelText(option.label, language)} <b>{option.count}</b>
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            <label className="af-scope-search">
              <span className="af-sr-only">{es ? 'Busca una liga' : 'Find a league'}</span>
              <input
                ref={inputRef}
                type="search"
                value={query}
                placeholder={es ? 'Busca una liga, deporte o plataforma' : 'Find a league, sport or platform'}
                onChange={(event) => setQuery(event.target.value)}
                autoComplete="off"
              />
            </label>

            <ul className="af-scope-list" aria-label={es ? 'Ligas' : 'Leagues'}>
              {shownLeagues.length === 0 ? (
                <li className="af-scope-empty">
                  {es ? 'Ninguna liga coincide con' : 'No league matches'} &ldquo;{query}&rdquo;.
                </li>
              ) : (
                shownLeagues.map((league) => {
                  const starred = favorites.has(league.id)
                  return (
                    <li key={league.id} className="af-scope-row" data-current={league.id === selectedLeagueId}>
                      <button
                        type="button"
                        className="af-scope-star"
                        aria-pressed={starred}
                        aria-label={
                          es
                            ? `${starred ? 'Quitar' : 'Añadir'} ${labelOf(league)} ${starred ? 'de' : 'a'} favoritas`
                            : `${starred ? 'Remove' : 'Add'} ${labelOf(league)} ${starred ? 'from' : 'to'} favorites`
                        }
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
                        <span className="af-scope-league-name">
                          {labelOf(league)}
                          {league.isCommissioner ? <CommissionerBadge /> : null}
                        </span>
                        <span className="af-scope-league-meta">
                          {league.sport} · {platformLabel(league.platform)}
                        </span>
                      </Link>
                    </li>
                  )
                })
              )}
            </ul>
            <p className="af-scope-note">
              {es ? 'Las favoritas se guardan en este dispositivo.' : 'Favorites are saved on this device.'}
            </p>
          </div>
        </>
      ) : null}
    </div>
  )
}

export default ScopeSwitcher
