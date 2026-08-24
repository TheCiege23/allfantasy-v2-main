'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { GeoRestrictionNotice } from '@/components/core-app/GeoRestrictionNotice'
import CommsDock from '@/components/core-app/comms/CommsDock'
import { SUPPORT_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'
import MiniPlayerImg from '@/components/MiniPlayerImg'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-core-shell.css'

/**
 * The chrome every AF Core screen sits inside: league rail, primary nav, top bar.
 *
 * Two rules from the handoff are enforced here rather than left to each screen,
 * because a screen that forgets either one misleads the user:
 *
 *   1. AllFantasy is READ-ONLY on every connected platform. The chip is part of
 *      the shell so it cannot be omitted, and its help text says plainly that we
 *      never change anything on Sleeper, ESPN or Yahoo.
 *   2. The last-sync age is always visible and turns `--warn` when stale, "rather
 *      than silently showing old numbers". `syncAge` is a required prop for the
 *      same reason sportsReadPort attaches freshness to every result — a caller
 *      that must pass it cannot forget to show it.
 */

export type PlatformId = 'sleeper' | 'espn' | 'yahoo'

export type RailLeague = {
  id: string
  name: string
  platform: PlatformId | string
  /** Single letter shown on the tile. */
  mark: string
  /** Something needs attention in this league. */
  hasAlert?: boolean
  alertTone?: 'bad' | 'warn'
}

export type CoreNavKey =
  | 'home'
  | 'my-team'
  | 'landing-preview'
  | 'matchup'
  | 'trades'
  | 'waivers'
  | 'players'
  | 'war-room'
  | 'draft-hq'
  | 'portfolio'
  | 'career'
  | 'rankings'
  | 'commissioner'
  | 'tools'
  // Handoff screens 24a/24b, 26b, 26a and 22c. All behind the same catch-all
  // route as everything else here — the repo is at Vercel's 2048-route ceiling.
  | 'week'
  | 'season-outlook'
  | 'share'
  | 'notifications'

type NavItem = {
  key: CoreNavKey
  label: string
  glyph: string
  href: string
  badge?: { text: string; tone: 'live' | 'level' | 'count' }
}

export type AfCoreShellProps = {
  active: CoreNavKey
  leagues: RailLeague[]
  /** Rendered from sportsReadPort freshness — label plus whether to warn. */
  syncAge: { label: string; stale: boolean }
  /** Null when the user has no plan context loaded; the chip is then omitted
   *  rather than showing a made-up tier. */
  plan?: { name: string; tokensLeft: number | null } | null
  weekLabel?: string | null
  commissionerCount?: number
  rankingsLevel?: number | null
  warRoomLive?: boolean
  /** Keeps league-scoped nav links pointed at the league in context. */
  selectedLeagueId?: string | null
  /**
   * Feeds the communications drawer (23a/23b) and the support modal (25b), both
   * mounted once here so every screen inherits them. Omitted on surfaces that
   * have no league context to offer.
   */
  comms?: {
    leagues: Array<{ id: string; name: string; platform: string }>
    chimmyTokenCost: number | null
    /** League-scoped screens dock the panel beside the content instead of over it. */
    dockable: boolean
    supportEmail: string | null
    /** Unread chat count for the launcher badge. */
    unread?: number
  } | null
  /** Unread count for the Notifications nav badge. Omitted when zero. */
  notificationCount?: number
  children: React.ReactNode
}

/**
 * How many league tiles the rail shows before handing off to Portfolio. Eight
 * fits above the fold at the shortest viewport the shell targets; beyond that
 * the rail stops being scannable anyway.
 */
const RAIL_TILE_LIMIT = 8

function navItems(props: AfCoreShellProps): NavItem[] {
  return [
    { key: 'home', label: 'Home', glyph: '▣', href: '/core' },
    // My team is league-scoped in the handoff, so the link carries the selected
    // league rather than dropping the user on a screen that has to ask which one.
    {
      key: 'my-team',
      label: 'My team',
      glyph: '◈',
      href: props.selectedLeagueId
        ? `/core/my-team?league=${encodeURIComponent(props.selectedLeagueId)}`
        : '/core/my-team',
    },
    {
      key: 'matchup',
      label: 'Matchup',
      glyph: '⚔',
      href: props.selectedLeagueId
        ? `/core/matchup?league=${encodeURIComponent(props.selectedLeagueId)}`
        : '/core/matchup',
    },
    {
      key: 'trades',
      label: 'Trades',
      glyph: '⇄',
      href: props.selectedLeagueId
        ? `/core/trades?league=${encodeURIComponent(props.selectedLeagueId)}`
        : '/core/trades',
    },
    {
      key: 'waivers',
      label: 'Waivers',
      glyph: '◷',
      href: props.selectedLeagueId
        ? `/core/waivers?league=${encodeURIComponent(props.selectedLeagueId)}`
        : '/core/waivers',
    },
    { key: 'players', label: 'Player Finder', glyph: '●', href: '/core/players' },
    // 24a — every matchup at once, ordered by what needs a decision. Cross-league,
    // so no ?league= on it: scoping this to one league is the thing it replaces.
    { key: 'week', label: 'Your week', glyph: '◱', href: '/core/week' },
    {
      key: 'war-room',
      label: 'War Room',
      glyph: '◆',
      href: props.selectedLeagueId
        ? `/core/war-room?league=${encodeURIComponent(props.selectedLeagueId)}`
        : '/core/war-room',
      badge: props.warRoomLive ? { text: 'LIVE', tone: 'live' } : undefined,
    },
    {
      key: 'draft-hq',
      label: 'Draft HQ',
      glyph: '▤',
      href: props.selectedLeagueId
        ? `/core/draft-hq?league=${encodeURIComponent(props.selectedLeagueId)}`
        : '/core/draft-hq',
    },
    { key: 'portfolio', label: 'Portfolio', glyph: '◈', href: '/core/portfolio' },
    /*
     * Restored: 'career' was pulled from the rail while it rendered "this screen
     * has not been built yet" — an apology occupying prime real estate. The
     * screen is the trophy room now, built from imported league history via
     * lib/core-app/career.ts — seasons, leagues, W-L, titles, playoff runs,
     * prestige and legacy — and it withholds any number it has no data behind
     * rather than showing a zero.
     */
    // Label and glyph are the handoff's, verbatim: "Your career" with ★. I first
    // shipped "Career" with ◷ — which is Waivers' glyph, so the rail had the same
    // mark twice.
    { key: 'career', label: 'Your career', glyph: '★', href: '/core/career' },
    // 26b — replaces the dashboard entry that pointed at /af-legacy?tab=pulse.
    { key: 'season-outlook', label: 'Season Outlook', glyph: '◎', href: '/core/season-outlook' },
    {
      key: 'rankings',
      label: 'Rankings',
      glyph: '↑',
      href: '/core/rankings',
      // Only shown when a level actually exists — never a placeholder "LVL 1".
      badge: props.rankingsLevel != null ? { text: `LVL ${props.rankingsLevel}`, tone: 'level' } : undefined,
    },
    {
      key: 'commissioner',
      label: 'Commissioner',
      glyph: '⚑',
      href: '/core/commissioner',
      badge:
        props.commissionerCount && props.commissionerCount > 0
          ? { text: String(props.commissionerCount), tone: 'count' }
          : undefined,
    },
    {
      key: 'notifications',
      label: 'Notifications',
      glyph: '◐',
      href: '/core/notifications',
      // Only when something is actually unread — a badge with nothing behind it
      // is an invented notification, the same rule ChimmyFab follows.
      badge:
        props.notificationCount && props.notificationCount > 0
          ? { text: String(props.notificationCount), tone: 'count' }
          : undefined,
    },
    { key: 'tools', label: 'Tools', glyph: '⚙', href: '/core/tools' },
  ]
}

type TopSearchHit = {
  id: string
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  sleeperId: string | null
  slug: string
}

/**
 * The shell's topbar search. Types into a real `<input>` and routes to
 * `/players/{slug}` — the same destination the dashboard and dash-v2 search
 * bars use, so every entry point in the app lands the same person on the same
 * page.
 *
 * ⚠ THIS WAS `<input>` WITH NO NAME, NO FORM, AND ZERO HANDLERS. Typing into it
 * did literally nothing — no request, no navigation, no fallback. It was the
 * least functional of the app's three "search any player or league" controls,
 * the other two (dashboard, dash-v2 topbar) at least navigated somewhere.
 */
function TopSearch() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<TopSearchHit[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [loading, setLoading] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setHits([])
      setLoading(false)
      return
    }
    setLoading(true)
    const ctl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/players/search?q=${encodeURIComponent(term)}&limit=8`, {
          signal: ctl.signal,
          cache: 'no-store',
        })
        if (!res.ok) {
          setHits([])
          return
        }
        const data = (await res.json()) as TopSearchHit[]
        setHits(Array.isArray(data) ? data : [])
        setActive(-1)
      } catch {
        // Aborted or offline — leave the previous list rather than flashing empty.
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [q])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function go(hit: TopSearchHit) {
    setOpen(false)
    setQ('')
    router.push(`/players/${hit.slug}`)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!open || hits.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % hits.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? hits.length - 1 : i - 1))
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      const hit = hits[active]
      if (hit) go(hit)
    }
  }

  const showList = open && q.trim().length >= 2

  return (
    <div className="af-search-wrap" ref={wrapRef}>
      {/* Real page for the no-JS/pre-hydration fallback — /players is a real route. */}
      <form action="/players" method="get" className="af-search" role="search">
        <span className="af-search-icon" aria-hidden>
          ○
        </span>
        <input
          className="af-search-input"
          name="q"
          type="search"
          placeholder="Search any player or league"
          aria-label="Search any player or league"
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-autocomplete="list"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <span className="af-search-kbd af-num" aria-hidden>
          ⌘K
        </span>
      </form>

      {showList ? (
        <ul className="af-search-ac" id={listId} role="listbox" aria-label="Player results">
          {hits.length === 0 ? (
            <li className="af-search-ac-empty" role="presentation">
              {loading ? 'Searching…' : 'No players match that.'}
            </li>
          ) : (
            hits.map((hit, i) => (
              <li key={hit.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={`af-search-ac-row${i === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(hit)}
                >
                  <MiniPlayerImg sleeperId={hit.sleeperId} name={hit.name} avatarUrl={hit.imageUrl} size={28} />
                  <span className="af-search-ac-text">
                    <span className="af-search-ac-name">{hit.name}</span>
                    <span className="af-search-ac-meta">
                      {[hit.position, hit.team].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}

function HelpDot({ title, body }: { title: string; body: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="af-help-wrap">
      <button
        type="button"
        className="af-help-dot"
        aria-label={title}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      {open ? (
        <span className="af-help-body" role="tooltip">
          <b>{title}</b>
          {body}
        </span>
      ) : null}
    </span>
  )
}

export function AfCoreShell(props: AfCoreShellProps) {
  const items = useMemo(() => navItems(props), [props])
  const { leagues, syncAge, plan, weekLabel, active, children, comms } = props

  return (
    <div className="af-core af-shell">
      {/* ── League rail ─────────────────────────────────────────────── */}
      <nav className="af-rail" aria-label="Leagues">
        <Link href="/core" className="af-rail-logo" aria-label="AllFantasy home">
          AF
        </Link>

        <div className="af-rail-divider" />

        {/*
          ⚠ CAPPED. The rail is a switcher, not an inventory. Seen on production:
          an account with 604 leagues rendered 604 tiles down a fixed-width column,
          running many screens past the fold and pushing the add button and the
          profile link somewhere nobody would ever scroll to. Portfolio is the
          screen that lists everything; this shows the first few and hands off.
        */}
        {leagues.slice(0, RAIL_TILE_LIMIT).map((l) => (
          <Link
            key={l.id}
            href={`/core?league=${encodeURIComponent(l.id)}`}
            className="af-rail-tile af-platform"
            data-platform={l.platform}
            title={`${l.name} · ${l.platform}`}
            aria-label={`${l.name} on ${l.platform}`}
          >
            {l.mark}
            {l.hasAlert ? <span className="af-rail-dot" data-tone={l.alertTone ?? 'warn'} /> : null}
          </Link>
        ))}

        {leagues.length > RAIL_TILE_LIMIT ? (
          <Link
            href="/core/portfolio"
            className="af-rail-tile af-rail-more"
            title={`${leagues.length - RAIL_TILE_LIMIT} more leagues — open Portfolio`}
            aria-label={`${leagues.length - RAIL_TILE_LIMIT} more leagues. Open Portfolio to see all of them.`}
          >
            +{leagues.length - RAIL_TILE_LIMIT > 99 ? '99' : leagues.length - RAIL_TILE_LIMIT}
          </Link>
        ) : null}

        <Link href="/import" className="af-rail-tile af-rail-add" aria-label="Add a league">
          +
        </Link>

        <div className="af-rail-spacer" />

        <Link href="/settings" className="af-rail-tile af-rail-profile" title="Profile, settings and modes">
          G
        </Link>
      </nav>

      {/* ── Primary nav ─────────────────────────────────────────────── */}
      <aside className="af-nav">
        <div className="af-nav-items">
          {items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="af-nav-item"
              data-active={item.key === active}
              aria-current={item.key === active ? 'page' : undefined}
            >
              <span className="af-nav-glyph" aria-hidden>
                {item.glyph}
              </span>
              <span className="af-nav-label">{item.label}</span>
              {item.badge ? (
                <span className="af-nav-badge" data-tone={item.badge.tone}>
                  {item.badge.text}
                </span>
              ) : null}
            </Link>
          ))}
        </div>

        {/*
          The import CTA states read-only and the time cost up front. Both are
          load-bearing: the first is the product's central promise, the second is
          what stops "connect a platform" reading as a commitment.
        */}
        <div className="af-import-cta">
          <div className="af-import-title">Import a league</div>
          <p className="af-import-body">Sleeper, ESPN or Yahoo. Read-only, takes about a minute.</p>
          <Link href="/import" className="af-btn af-import-btn">
            Connect a platform
          </Link>
        </div>

        {/*
          25b's entry point. A button rather than a link to /support because the
          modal keeps the user where they are and attaches the page they were on
          — which is the diagnostic that makes a report actionable. /support is
          still there for anyone who arrives at it directly.
        */}
        <button
          type="button"
          className="af-nav-support"
          onClick={() => window.dispatchEvent(new CustomEvent(SUPPORT_OPEN_EVENT))}
        >
          Contact support
        </button>
      </aside>

      {/* ── Main column ─────────────────────────────────────────────── */}
      <div className="af-main">
        <header className="af-topbar">
          <TopSearch />

          <div className="af-topbar-right">
            <span className="af-readonly">
              Read-only
              <HelpDot
                title="Read-only by design"
                body="AllFantasy never changes anything on Sleeper, ESPN or Yahoo. We read your leagues and point you to the exact league and screen where you make the change."
              />
            </span>

            {weekLabel ? <span className="af-week af-num">{weekLabel}</span> : null}

            <span className="af-sync af-num" data-stale={syncAge.stale} title="Last sync">
              {syncAge.stale ? '⚠ ' : ''}
              synced {syncAge.label}
            </span>

            {plan ? (
              <span className="af-plan">
                <span className="af-plan-name af-label">{plan.name}</span>
                {plan.tokensLeft != null ? (
                  <>
                    <span className="af-plan-tokens af-num">{plan.tokensLeft.toLocaleString()}</span>
                    <span className="af-label">tokens left</span>
                  </>
                ) : null}
                <HelpDot
                  title="Plan tokens"
                  body="Your plan includes a monthly allowance of Chimmy requests — grades, projections and recommendations. Resets on your billing date."
                />
              </span>
            ) : null}
          </div>
        </header>

        <main className="af-content">
          {/*
            ⚠ COMPLIANCE, NOT CHROME — AND IT SITS IN THE SHELL SO NO SCREEN CAN
            FORGET IT. /dashboard carried this and /core did not, which made it a
            blocker on the cutover: retiring the old dashboard without it would
            have started offering paid plans in states where we do not sell them.
            Rendering it once here means every screen inherits it rather than each
            one remembering.
          */}
          <GeoRestrictionNotice />
          {children}
        </main>
      </div>

      {/*
        23a/23b + 25b, mounted once for the whole shell.

        Both are overlays that must survive navigation — the drawer's entire
        product argument is "never a page you navigate to and lose your place",
        and a per-screen mount would unmount it on every link. Same placement
        reasoning as GeoRestrictionNotice above.
      */}
      {comms ? (
        <CommsDock
          leagues={comms.leagues}
          pageLeagueId={props.selectedLeagueId ?? null}
          chimmyTokenCost={comms.chimmyTokenCost}
          dockable={comms.dockable}
          supportEmail={comms.supportEmail}
          unread={comms.unread ?? 0}
        />
      ) : null}
    </div>
  )
}

export default AfCoreShell
