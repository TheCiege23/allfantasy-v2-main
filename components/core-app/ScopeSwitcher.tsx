'use client'

import Link from 'next/link'
import { leagueEntryHref } from '@/lib/league/leagueEntryHref'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { coreLeagueHref } from '@/lib/core-app/leagueNavigation'
import { LeagueMark } from '@/components/core-app/LeagueMark'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useOverlayContainment } from '@/components/core-app/useOverlayContainment'
import { CommissionerBadge } from '@/components/core-app/CommissionerBadge'
import {
  FAVORITES_COOKIE,
  HOME_SCOPE_PARAM,
  parseHomeScope,
  platformLabel,
  platformOf,
  SCOPE_COOKIE,
  scopeOptions,
  serializeFavoriteIds,
  sportOf,
  type ScopeLeague,
} from '@/lib/core-app/homeScope'
import { leagueSportIcon, leagueSportKey, leagueSportLabel } from '@/lib/core-app/leagueSports'
import { applyLeagueOrder } from '@/lib/core-app/leaguePreferences'
import { FAVORITES_SECTION, moveInOrder, railSections, reorderWithinSection } from '@/lib/core-app/railArrange'
import { hideLeagueForAccount, saveLeaguePreference, unhideLeagueForAccount, useRailDrag } from '@/components/core-app/RailLeagueMenu'
import { distinctLeagueLabels } from '@/lib/core-app/leagueNameCollision'
import { pairExileUnderSurvivor, pairedExileIds } from '@/lib/core-app/survivorExileRail'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { scopeLabelText } from '@/lib/core-app/shellCopy'
import { useMessages } from '@/components/i18n/useMessages'
import { scopeSwitcherMessages } from '@/lib/core-app/messages/scopeSwitcher'
import { railRowMessages } from '@/lib/core-app/messages/railRow'
import type { RailRecord } from '@/lib/core-app/railRecordRank'
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
 * ⚠ THE STAR IS THE ACCOUNT'S (since 2026-10-02, see `toggleFavorite`): saved to the account's
 * favorites list, which the server reads first, with `FAVORITES_COOKIE` (lib/core-app/homeScope.ts)
 * only this device's fallback until a first save exists. The note under the list said "saved on this
 * device" for five weeks after that stopped being true (fixed 2026-11-08).
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
    <Link href={`/core?view=all&${HOME_SCOPE_PARAM}=all`} className={className} onClick={() => writeCookie(SCOPE_COOKIE, null, null)}>
      {children}
    </Link>
  )
}

export type ScopeSwitcherLeague = {
  id: string
  name: string
  platform: string
  sport: string
  imageUrl?: string | null
  /** The viewer commissions it — draws the blue C (CommissionerBadge). */
  isCommissioner?: boolean
  /** On an Exile Island: its Survivor league's id. The list draws the island under that league. */
  exileOf?: string
  /**
   * Your record and place — the rail row's "6-3 · 2nd" (lib/core-app/railRecords.ts). Null for a
   * league with no record to state, and for a Guillotine or elimination race, where W-L says nothing.
   */
  record?: RailRecord | null
  /**
   * Where you stand in a field race — a Guillotine or elimination league, where `record` is null on
   * purpose. The rail row's own line ("3rd of 10 alive", "Chopped wk 5"), so the phone list says how
   * you stand in EVERY league, not only the head-to-head ones.
   */
  field?: ScopeSwitcherField | null
}

export type ScopeSwitcherField =
  | { state: 'alive'; rank: number | null; outOf: number }
  | { state: 'chopped'; week: number | null }

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
  /**
   * Archived leagues (lib/core-app/archivedLeagues.ts): out of the list AND out of search, unlike
   * `hiddenIds`. The open league always shows.
   */
  archivedIds?: string[]
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

/**
 * What the list is narrowed to, INSIDE the picker. A sport and a platform combine; tapping a pressed
 * chip lets it go.
 *
 * ⚠ THE CHIPS FILTER THE LIST, THEY DO NOT NAVIGATE (user report, 2026-11-08: "when I click sport or
 * platform it should only show me the ones I clicked — right now it takes me to another page"). The
 * chips used to be links to a filtered Home, so choosing a sport closed the picker and swapped the
 * page underneath. Filtering Home is still one tap away — the "Use this filter on Home" link under
 * the chips — but it is now a deliberate act, not the side effect of narrowing a list.
 */
type ListFilter = { fav: boolean; sport: string | null; platform: string | null }
const NO_FILTER: ListFilter = { fav: false, sport: null, platform: null }

function filterFromScope(value: string | null): ListFilter {
  const scope = parseHomeScope(value)
  if (scope.kind === 'favorites') return { ...NO_FILTER, fav: true }
  if (scope.kind === 'sport') return { ...NO_FILTER, sport: scope.sport }
  if (scope.kind === 'platform') return { ...NO_FILTER, platform: scope.platform }
  return NO_FILTER
}

/** The Home scope a filter names — `undefined` when it combines two facets, which Home cannot show. */
function filterToScope(f: ListFilter): string | null | undefined {
  const set = Number(f.fav) + Number(f.sport != null) + Number(f.platform != null)
  if (set > 1) return undefined
  if (f.fav) return 'fav'
  if (f.sport) return `sport:${f.sport}`
  if (f.platform) return `platform:${f.platform}`
  return null
}

function passes(f: ListFilter, league: ScopeLeague, favorites: ReadonlySet<string>, skip?: 'sport' | 'platform'): boolean {
  if (f.fav && !favorites.has(league.id)) return false
  if (skip !== 'sport' && f.sport && sportOf(league) !== f.sport) return false
  if (skip !== 'platform' && f.platform && platformOf(league) !== f.platform) return false
  return true
}

/** The platform key the shared `.af-platform` colours read (af-core.css); AllFantasy's own as `native`. */
function platformTone(platform: string): string {
  return isNativePlatform(platform) || platform === 'allfantasy' ? 'native' : platform.toLowerCase()
}

const SETTINGS_LEAGUES_HREF = '/settings?tab=preferences&returnTo=%2Fcore#your-leagues'

export function ScopeSwitcher({ leagues, scopeValue, label, selectedLeagueId, favoriteIds, leagueScreen, hiddenIds = [], archivedIds = [] }: Props) {
  const router = useRouter()
  const pathname = usePathname() ?? '/core'
  /*
   * The switcher's words in the reader's language (2026-10-03) — it sits in the top bar of every /core
   * screen, and a live Spanish check found all of it in English. A league's OWN name is never
   * translated: `label` is only passed through `scopeLabelText` when no league is selected.
   */
  const { language } = useOptionalLanguage()
  const m = useMessages(scopeSwitcherMessages)
  const railMsg = useMessages(railRowMessages)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ListFilter>(() => filterFromScope(scopeValue))
  const [editing, setEditing] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
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

  /* Order and hidden, edited from Customize: shown at once, saved to the account, dropped when the server agrees. */
  const leagueKey = leagues.map((l) => l.id).join('.')
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null)
  useEffect(() => setOrderOverride(null), [leagueKey])
  const hiddenKey = hiddenIds.join('.')
  const [hiddenOverride, setHiddenOverride] = useState<Set<string> | null>(null)
  useEffect(() => setHiddenOverride(null), [hiddenKey])

  useOverlayContainment({
    active: open,
    containerRef: panelRef,
    onClose: () => setOpen(false),
    initialFocusRef: inputRef,
    keepClickableRefs: clickableRefs,
  })

  // Each opening starts from what Home is showing, so the chips and the page agree.
  useEffect(() => {
    if (open) return
    setQuery('')
    setEditing(false)
    setFilter(filterFromScope(scopeValue))
  }, [open, scopeValue])

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
  const archivedKey = archivedIds.join('.')
  const hidden = useMemo(
    () => hiddenOverride ?? new Set(hiddenKey ? hiddenKey.split('.') : []),
    [hiddenOverride, hiddenKey],
  )
  const archived = useMemo(() => new Set(archivedKey ? archivedKey.split('.') : []), [archivedKey])
  // An archived league is never offered here, typed for or not — only the open one stays.
  const offered = useMemo(
    () => leagues.filter((l) => !archived.has(l.id) || l.id === selectedLeagueId),
    [leagues, archived, selectedLeagueId],
  )
  const hiddenCount = offered.filter((l) => hidden.has(l.id) && l.id !== selectedLeagueId).length
  const revealHidden = editing || showHidden

  /*
   * The chip counts follow the OTHER chips, so "Sleeper 12" under NFL means twelve NFL leagues on
   * Sleeper — the number a tap would leave. They count hidden leagues too: they describe what each
   * filter shows on Home, where a hidden league still counts.
   */
  const sportCounts = useMemo(() => {
    const out = new Map<string, number>()
    for (const l of leagues) if (passes(filter, l, favorites, 'sport')) out.set(sportOf(l), (out.get(sportOf(l)) ?? 0) + 1)
    return out
  }, [leagues, filter, favorites])
  const platformCounts = useMemo(() => {
    const out = new Map<string, number>()
    for (const l of leagues) if (passes(filter, l, favorites, 'platform')) out.set(platformOf(l), (out.get(platformOf(l)) ?? 0) + 1)
    return out
  }, [leagues, filter, favorites])

  const shownLeagues = useMemo(() => {
    const ordered = orderOverride ? applyLeagueOrder(offered, orderOverride) : offered
    const matched = q
      ? ordered.filter(
          (l) =>
            (labels.get(l.id) ?? l.name).toLowerCase().includes(q) ||
            l.sport.toLowerCase() === q ||
            platformLabel(l.platform).toLowerCase().includes(q),
        )
      : ordered.filter((l) => revealHidden || !hidden.has(l.id) || l.id === selectedLeagueId)
    return matched.filter((l) => passes(filter, l, favorites))
  }, [offered, orderOverride, labels, q, revealHidden, hidden, selectedLeagueId, filter, favorites])

  /*
   * ⚠ BY SPORT, THE WAY THE DESKTOP RAIL IS (user report, 2026-11-08: "the league list on mobile does
   * not specify the sport like it does on PC"). Favorites on top, then one section per sport with its
   * ball and count — the rail's own `railSections`, so the two lists group identically. A list of one
   * sport draws no heading; it would only repeat what every row says. Each Exile Island still sits
   * directly under its Survivor league, within its section.
   */
  const sections = useMemo(
    () => railSections(shownLeagues, filter.fav ? new Set<string>() : favorites).map((section) => ({ ...section, rows: pairExileUnderSurvivor(section.rows) })),
    [shownLeagues, favorites, filter.fav],
  )
  const headed = sections.length > 1

  const filterHref = (value: string | null) =>
    value == null ? `/core?view=all&${HOME_SCOPE_PARAM}=all` : `/core?view=all&${HOME_SCOPE_PARAM}=${encodeURIComponent(value)}`

  const leagueHref = (id: string) => {
    const league = leagues.find(row => row.id === id)
    return league && isNativePlatform(league.platform)
      ? leagueEntryHref(league)
      : coreLeagueHref(pathname, id, leagueScreen)
  }

  const navigate = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    setOpen(false)
    router.push(href)
  }

  const homeValue = filterToScope(filter)
  const offerHome = homeValue !== undefined && homeValue !== scopeValue && leagues.length > 0
  const applyToHome = () => writeCookie(SCOPE_COOKIE, homeValue ?? null, null)

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

  /*
   * Customize — the same two saved lists the rail's press-and-hold menu writes (leaguePreferences.ts),
   * so an order or a hide set here is the order and the hide everywhere: rail, Home, My Leagues.
   */
  const moveLeague = (id: string, direction: -1 | 1, sectionIds: string[]) => {
    const fullOrder = orderOverride ?? leagues.map((l) => l.id)
    const next = moveInOrder(fullOrder, sectionIds, id, direction)
    if (!next) return
    setOrderOverride(next)
    saveLeaguePreference('order', next, () => router.refresh())
  }
  /*
   * ⚠ DRAG TO REORDER, BY THE ⠿ GRIP ONLY (user ask, 2026-11-08). The rail's own drag (useRailDrag), so
   * a drop lands exactly where the same drag on the desktop rail would and saves the same order. Only
   * the grip takes the finger: the rest of the row still scrolls the sheet, which a phone list must
   * keep doing. The ↑ ↓ buttons stay — a precise one-step move, and the way in without a pointer.
   */
  const drag = useRailDrag((sectionIds, id, toIndex) => {
    const fullOrder = orderOverride ?? leagues.map((l) => l.id)
    const next = reorderWithinSection(fullOrder, sectionIds, id, toIndex)
    if (!next) return
    setOrderOverride(next)
    saveLeaguePreference('order', next, () => router.refresh())
  })
  const toggleHidden = (id: string) => {
    const next = new Set(hidden)
    if (next.has(id)) {
      next.delete(id)
      unhideLeagueForAccount(id, () => router.refresh())
    } else {
      next.add(id)
      hideLeagueForAccount(id, () => router.refresh())
    }
    setHiddenOverride(next)
  }

  const chip = (key: string, pressed: boolean, count: number, onClick: () => void, children: ReactNode, extra?: { disabled?: boolean; title?: string; tone?: string }) => (
    <button
      key={key}
      type="button"
      className="af-scope-chip"
      aria-pressed={pressed}
      disabled={extra?.disabled && !pressed}
      title={extra?.title}
      data-platform={extra?.tone}
      onClick={onClick}
    >
      {children} <b>{count}</b>
    </button>
  )

  const sportOptions = options.filter((o) => o.group === 'sport')
  const platformOptions = options.filter((o) => o.group === 'platform')
  const favCount = options.find((o) => o.group === 'favorites')?.count ?? 0
  const anyFilter = filter.fav || filter.sport != null || filter.platform != null

  const fieldText = (f: ScopeSwitcherField) =>
    f.state === 'chopped'
      ? f.week != null ? railMsg.choppedWeek(f.week) : railMsg.chopped
      : f.rank != null ? `${railMsg.rank(f.rank)}${railMsg.ofAlive(f.outOf)}` : railMsg.aliveCount(f.outOf)

  const renderRow = (league: ScopeSwitcherLeague, isExile: boolean, sectionIds: string[], sectionKey: string) => {
    const starred = favorites.has(league.id)
    const isHidden = hidden.has(league.id) && league.id !== selectedLeagueId
    const at = sectionIds.indexOf(league.id)
    const sportKey = leagueSportKey(league.sport)
    const tone = platformTone(league.platform)
    return (
      <li
        key={league.id}
        className="af-scope-row"
        data-current={league.id === selectedLeagueId}
        data-exile={isExile ? 'true' : undefined}
        data-hidden={isHidden ? 'true' : undefined}
        data-platform={tone}
        {...(editing ? drag.rowAttrs(league.id, sectionKey) : {})}
      >
        {/* A sport with one league has nothing to drag past: its grip is drawn, dimmed, so the rows still line up. */}
        {editing ? (
          <span
            className="af-scope-grip"
            data-testid="scope-drag-handle"
            data-disabled={sectionIds.length < 2 ? 'true' : undefined}
            aria-hidden
            {...(sectionIds.length < 2 ? {} : drag.handleProps(league.id, sectionKey))}
          >
            ⠿
          </span>
        ) : null}
        <button
          type="button"
          className="af-scope-star"
          aria-pressed={starred}
          aria-label={m.starLabel(starred, labelOf(league))}
          onClick={() => toggleFavorite(league.id)}
        >
          {starred ? '★' : '☆'}
        </button>
        <Link
          href={leagueHref(league.id)}
          className="af-scope-league"
          aria-current={league.id === selectedLeagueId ? 'true' : undefined}
          aria-label={isExile ? labelOf(league) : undefined}
          prefetch={false}
          onClick={(event) => navigate(event, leagueHref(league.id))}
        >
          <span className="af-scope-league-art"><LeagueMark src={league.imageUrl} letter={Array.from(league.name)[0] ?? "L"} /></span>
          <span className="af-scope-league-name">
            {isExile ? coreUiCopy('Exile Island', language) : labelOf(league)}
            {league.isCommissioner ? <CommissionerBadge /> : null}
          </span>
          <span className="af-scope-league-meta">
            {/* The sport with its ball, then the platform in its own colour — the rail row's chip (RailRowBody). */}
            {sportKey || league.sport ? (
              <span className="af-scope-league-sport" data-testid="scope-league-sport">
                {leagueSportIcon(sportKey) ? <span className="af-scope-league-ball" aria-hidden>{leagueSportIcon(sportKey)}</span> : null}
                {sportKey ? leagueSportLabel(sportKey, { short: true }) : league.sport}
              </span>
            ) : null}
            <span className="af-platform af-platform-chip af-scope-league-plat" data-platform={tone} data-testid="scope-league-platform">
              {platformLabel(league.platform)}
            </span>
            {/* Same words as the rail row (RailRowBody), so the two lists agree. */}
            {league.record ? (
              <span className="af-scope-league-record af-num" data-testid="scope-league-record">
                {league.record.wins}-{league.record.losses}{league.record.ties ? `-${league.record.ties}` : ''}
                {league.record.rank != null ? ` · ${railMsg.rank(league.record.rank)}` : ''}
              </span>
            ) : league.field ? (
              <span className="af-scope-league-record af-num" data-testid="scope-league-field" data-state={league.field.state}>
                {fieldText(league.field)}
              </span>
            ) : null}
            {isHidden ? <span className="af-scope-league-hidden">{m.hiddenTag}</span> : null}
          </span>
        </Link>
        {editing ? (
          <span className="af-scope-edit">
            <button type="button" className="af-scope-edit-btn" aria-label={m.moveUp(labelOf(league))} disabled={at <= 0} onClick={() => moveLeague(league.id, -1, sectionIds)}>↑</button>
            <button type="button" className="af-scope-edit-btn" aria-label={m.moveDown(labelOf(league))} disabled={at < 0 || at >= sectionIds.length - 1} onClick={() => moveLeague(league.id, 1, sectionIds)}>↓</button>
            {league.id === selectedLeagueId ? null : (
              <button
                type="button"
                className="af-scope-edit-btn"
                aria-pressed={isHidden}
                aria-label={isHidden ? m.unhideLeague(labelOf(league)) : m.hideLeague(labelOf(league))}
                data-action="hide"
                onClick={() => toggleHidden(league.id)}
              >
                {isHidden ? <EyeOff /> : <Eye />}
              </button>
            )}
          </span>
        ) : null}
      </li>
    )
  }

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
          {selectedLeagueId ? m.kickerLeague : m.kickerViewing}
        </span>
        <span className="af-scope-label">
          <span className="af-sr-only">{m.viewingSr}</span>
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
            aria-label={m.closePicker}
            onClick={() => setOpen(false)}
          />
          <div ref={panelRef} id={panelId} className="af-scope-panel" role="dialog" aria-modal="true" aria-label={m.chooseLeagues} data-editing={editing ? 'true' : undefined}>
            <div className="af-scope-head">
              <strong>{m.whichLeagues}</strong>
              {/*
                ⚠ CUSTOMIZE LIVES IN THE PICKER NOW (user report, 2026-11-08: "where is the customize
                league list option? Show hidden leagues? Reorder?"). On a phone the rail's press-and-hold
                menu was the only other way in, and nothing on screen said it existed.
              */}
              <button
                type="button"
                className="af-scope-tool"
                aria-pressed={editing}
                data-variant={editing ? 'done' : undefined}
                data-testid="scope-customize"
                onClick={() => setEditing((v) => !v)}
              >
                {editing ? m.customizeDone : <>⚙ {m.customize}</>}
              </button>
              <button type="button" className="af-scope-close" aria-label={m.closePicker} onClick={() => setOpen(false)}>
                ×
              </button>
            </div>

            <div className="af-scope-filters">
              <div className="af-scope-group" role="group" aria-label={m.scope}>
                <div className="af-scope-chips">
                  {chip('all', !anyFilter, leagues.length, () => setFilter(NO_FILTER), scopeLabelText('All leagues', language))}
                  {chip(
                    'fav',
                    filter.fav,
                    favCount,
                    () => setFilter((f) => ({ ...f, fav: !f.fav })),
                    <>★ {m.favorites}</>,
                    { disabled: favCount === 0, title: favCount === 0 ? m.starToUse : undefined },
                  )}
                  {hiddenCount > 0 && !editing ? (
                    <button
                      type="button"
                      className="af-scope-chip"
                      aria-pressed={showHidden}
                      data-testid="scope-show-hidden"
                      aria-label={m.showHidden(hiddenCount)}
                      onClick={() => setShowHidden((v) => !v)}
                    >
                      {showHidden ? <Eye /> : <EyeOff />} {m.hiddenTag} <b>{hiddenCount}</b>
                    </button>
                  ) : null}
                </div>
              </div>
              {sportOptions.length > 0 ? (
                <div className="af-scope-group" role="group" aria-label={m.sport}>
                  <span className="af-scope-group-title">{m.sport}</span>
                  <div className="af-scope-chips">
                    {sportOptions.map((o) => {
                      const sport = o.value!.slice('sport:'.length)
                      const icon = leagueSportIcon(leagueSportKey(sport))
                      const count = sportCounts.get(sport) ?? 0
                      return chip(
                        o.value!,
                        filter.sport === sport,
                        count,
                        () => setFilter((f) => ({ ...f, sport: f.sport === sport ? null : sport })),
                        // The list headings' short names (CFB, CBB): "NCAAF" is what pushed a chip off a phone.
                        <>{icon ? <span className="af-scope-chip-icon" aria-hidden>{icon}</span> : null}{leagueSportKey(sport) ? leagueSportLabel(leagueSportKey(sport), { short: true }) : o.label}</>,
                        { disabled: count === 0 },
                      )
                    })}
                  </div>
                </div>
              ) : null}
              {platformOptions.length > 0 ? (
                <div className="af-scope-group" role="group" aria-label={m.platform}>
                  <span className="af-scope-group-title">{m.platform}</span>
                  <div className="af-scope-chips">
                    {platformOptions.map((o) => {
                      const platform = o.value!.slice('platform:'.length)
                      const count = platformCounts.get(platform) ?? 0
                      return chip(
                        o.value!,
                        filter.platform === platform,
                        count,
                        () => setFilter((f) => ({ ...f, platform: f.platform === platform ? null : platform })),
                        <><span className="af-platform af-scope-chip-dot" data-platform={platformTone(platform)} aria-hidden />{o.label}</>,
                        { disabled: count === 0 },
                      )
                    })}
                  </div>
                </div>
              ) : null}
              {offerHome ? (
                <Link
                  href={filterHref(homeValue ?? null)}
                  className="af-scope-apply"
                  prefetch={false}
                  data-testid="scope-apply-home"
                  onClick={(event) => { applyToHome(); navigate(event, filterHref(homeValue ?? null)) }}
                >
                  {homeValue == null ? m.showAllOnHome : m.applyToHome} →
                </Link>
              ) : null}
            </div>

            <label className="af-scope-search">
              <span className="af-sr-only">{m.findLeague}</span>
              <input
                ref={inputRef}
                type="search"
                value={query}
                placeholder={m.findPlaceholder}
                onChange={(event) => setQuery(event.target.value)}
                autoComplete="off"
              />
            </label>

            {editing ? (
              <p className="af-scope-edit-hint">
                {m.customizeHint}{' '}
                <Link href={SETTINGS_LEAGUES_HREF} prefetch={false} onClick={(event) => navigate(event, SETTINGS_LEAGUES_HREF)}>
                  {m.moreInSettings}
                </Link>
              </p>
            ) : null}

            <ul className="af-scope-list" aria-label={m.leagues} data-rail-list="">
              {shownLeagues.length === 0 ? (
                <li className="af-scope-empty">
                  {q ? <>{m.noLeagueMatches} &ldquo;{query}&rdquo;.</> : m.noLeaguesInFilter}
                </li>
              ) : (
                sections.map((section) => {
                  const exileRows = pairedExileIds(section.rows)
                  const sectionIds = section.rows.map((l) => l.id)
                  const isFav = section.key === FAVORITES_SECTION
                  // A league with no sport files under "Other" — the shared label is English-only, so the heading uses ours.
                  const title = isFav ? m.favorites : section.key == null ? m.otherSport : leagueSportLabel(section.key, { short: true })
                  const icon = isFav ? '★' : leagueSportIcon(section.key)
                  return [
                    headed ? (
                      <li
                        key={`section-${section.key ?? 'other'}`}
                        className="af-scope-section"
                        data-section={section.key ?? 'other'}
                        data-testid="scope-sport-heading"
                        aria-label={m.sectionAria(title, section.rows.length)}
                      >
                        {icon ? <span className="af-scope-section-icon" aria-hidden>{icon}</span> : null}
                        <span className="af-scope-section-label" aria-hidden>{title}</span>
                        <span className="af-scope-section-count af-num" aria-hidden>{section.rows.length}</span>
                      </li>
                    ) : null,
                    ...section.rows.map((league) => {
                      const isExile = exileRows.has(league.id)
                      const row = renderRow(league, isExile, sectionIds, section.key ?? 'other')
                      if (!isExile) return row
                      return [
                        <li key={`exile-link-${league.id}`} className="af-scope-exile-link" data-testid="scope-exile-link" aria-hidden>↕</li>,
                        row,
                      ]
                    }),
                  ]
                })
              )}
            </ul>
            <p className="af-scope-note">
              {m.favoritesNote}
            </p>
          </div>
        </>
      ) : null}
    </div>
  )
}

function Eye() {
  return (
    <svg className="af-scope-eye" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOff() {
  return (
    <svg className="af-scope-eye" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17.9 17.9A10.4 10.4 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 5.1-5.9" />
      <path d="M9.9 4.2A9.6 9.6 0 0 1 12 4c6.5 0 10 7 10 7a18.6 18.6 0 0 1-2.2 3.2" />
      <path d="M2 2l20 20" />
    </svg>
  )
}

export default ScopeSwitcher
