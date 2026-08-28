'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { GeoRestrictionNotice } from '@/components/core-app/GeoRestrictionNotice'
import CommsDock from '@/components/core-app/comms/CommsDock'
import type { CommsLeague } from '@/components/core-app/comms/CommsDrawer'
import { AfCrest } from '@/components/core-app/AfCrest'
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
  /** Single letter shown on the tile — the genuine fallback when no image renders. */
  mark: string
  /**
   * Resolved league image URL (commissioner logoUrl, or a Sleeper avatar hash
   * already resolved to its sleepercdn URL by the caller) — never a bare hash,
   * which would 404 as a src. Null/omitted renders `mark`.
   */
  imageUrl?: string | null
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
  // Full pages OUTSIDE /core, listed in the shell so the cutover to /core does
  // not orphan them. No /core segment maps to these keys, so they are never the
  // active item — they are exits, not screens.
  | 'live-scores'
  | 'my-leagues'
  | 'league-sync'
  | 'settings'
  /*
   * 38a. `live` is the league-dashboard entry to the cross-league live slate
   * that /live already serves — same data layer, inside the shell. `standings`
   * and `sync` land with their screens in later phases; adding a nav entry
   * before its screen exists is what produced the "not built yet" panel this
   * suite is replacing.
   */
  | 'live'
  /*
   * 38a·7. NOT 'rankings' — that key is the cross-app XP ladder. This is the
   * league's points-for board, which is a different measurement of a different
   * thing that happens to share the English word.
   */
  | 'standings'
  /* 38a·10 — per-league sync. The account-wide /leagues/sync page keeps connect,
     OAuth and re-sync; this answers "is THIS league current", which that page
     structurally cannot. Adding a league belongs to /import — one import
     pipeline, not two. */
  | 'sync'

type NavItem = {
  key: CoreNavKey
  label: string
  glyph: string
  href: string
  badge?: { text: string; tone: 'live' | 'level' | 'count' }
}

/**
 * Nav sections.
 *
 * ⚠ THIS WAS A FLAT LIST OF SIXTEEN AND 38a TAKES IT TO NINETEEN. Sixteen
 * undifferentiated rows already scanned as a wall; nineteen is not a nav, it is
 * an index. The grouping is the same cut the Tools screen already makes — what
 * you decide inside one league, what is happening this week, what you have
 * done, and what you administer — so the two surfaces describe the product the
 * same way instead of two different ways.
 *
 * Headings are presentational only: every item keeps its own key and href, so
 * nothing about routing or active state changes with them.
 */
type NavSection = { id: string; heading: string | null; items: NavItem[] }

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
    leagues: CommsLeague[]
    chimmyTokenCost: number | null
    /** Ids+counts the /core home is showing — see lib/core-app/homeSignals.ts. */
    homeSignals?: string | null
    /** League-scoped screens dock the panel beside the content instead of over it. */
    dockable: boolean
    supportEmail: string | null
    /** Unread chat count for the launcher badge. */
    unread?: number
    /** Of those, how many name you. Badged louder — see CommsDock. */
    mentions?: number
  } | null
  /** Unread count for the Notifications nav badge. Omitted when zero. */
  notificationCount?: number
  /**
   * The signed-in account, for the rail's profile chip. `imageUrl` must be a
   * resolved URL or null; `name` feeds the initial fallback. Omitted or empty
   * renders a neutral mark rather than inventing an identity — the chip was
   * previously a hardcoded 'G' for every account.
   */
  profile?: { name: string | null; imageUrl: string | null } | null
  /**
   * Games in progress right now, for the Live scores badge. Same rule as every
   * other badge here: only rendered when something is actually live, never a
   * placeholder. Null/0 means the slate is quiet or we could not read it, and
   * either way the badge is absent rather than showing a zero.
   */
  liveGameCount?: number | null
  children: React.ReactNode
}

/**
 * How many league tiles the rail shows before handing off to Portfolio. Eight
 * fits above the fold at the shortest viewport the shell targets; beyond that
 * the rail stops being scannable anyway.
 */
const RAIL_TILE_LIMIT = 8

/**
 * The rail groups, and why it has them: twenty flat entries ran the column past
 * a thousand pixels, so Settings and Contact support sat below the fold, and
 * league-scoped tools were interleaved with cross-league screens under no
 * heading that said which was which.
 *
 * Membership is declared here rather than on each item so adding a nav entry
 * stays a one-line change — and an entry missing from every group still renders
 * (see the leftovers rule) rather than silently disappearing from the product.
 */
const NAV_GROUPS: Array<{ label: string | null; keys: CoreNavKey[] }> = [
  { label: null, keys: ['home'] },
  {
    label: 'This league',
    keys: ['my-team', 'matchup', 'trades', 'waivers', 'draft-hq', 'war-room'],
  },
  {
    label: 'Across leagues',
    keys: ['week', 'live-scores', 'players', 'season-outlook', 'portfolio', 'my-leagues'],
  },
  {
    label: 'You',
    keys: ['career', 'rankings', 'notifications', 'commissioner', 'league-sync', 'tools', 'settings'],
  },
]


function navItems(props: AfCoreShellProps): NavItem[] {
  /*
   * ⚠ A CROSS-LEAGUE SCREEN STILL CARRIES THE LEAGUE. Home, Portfolio, Rankings
   * and Tools each read across every league, and each used to link without
   * `?league=` for that reason — which silently CLEARED the rail's selection.
   * Clicking Home from inside a league and then Matchup landed you back on
   * "pick a league", having undone a choice you never asked to undo.
   *
   * Being cross-league is about what a screen READS, not about whether the app
   * should forget where you were. `week` and `live` already worked this way:
   * they show everything and carry the league so the rail stays put.
   */
  const inLeague = (path: string) =>
    props.selectedLeagueId
      ? `${path}?league=${encodeURIComponent(props.selectedLeagueId)}`
      : path

  return [
    { key: 'home', label: 'Home', glyph: '▣', href: inLeague('/core') },
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
    {
      key: 'players',
      label: 'Player Finder',
      glyph: '●',
      // 38a scopes this to the league in context — "in THIS league" rather than
      // "across every platform" — so the link carries the league the way the
      // other league-scoped entries do. Without ?league= it stays the
      // cross-platform finder it is today.
      href: props.selectedLeagueId
        ? `/core/players?league=${encodeURIComponent(props.selectedLeagueId)}`
        : '/core/players',
    },
    /*
     * 24a — every matchup at once, ordered by what needs a decision.
     *
     * ⚠ THE LEAGUE ID IS DELIBERATE AND DOES NOT NARROW THE SCREEN BY ITSELF.
     * 38a adds a one-league hero to this same key (the user's call: add a
     * league view, do not replace the cross-league board). The screen reads the
     * parameter; the cross-league board is still what renders without it.
     */
    {
      key: 'week',
      label: 'Your week',
      glyph: '◱',
      href: props.selectedLeagueId
        ? `/core/week?league=${encodeURIComponent(props.selectedLeagueId)}`
        : '/core/week',
    },
    /*
     * 38a — the live slate, inside the shell. Cross-league by definition: the
     * question it answers is "what is happening right now across everything I
     * own", which stops meaning anything scoped to one league. It carries the
     * league only so the screen can mark which tie-ins are this league's.
     */
    {
      key: 'live',
      label: 'Live scores',
      glyph: '◉',
      href: props.selectedLeagueId
        ? `/core/live?league=${encodeURIComponent(props.selectedLeagueId)}`
        : '/core/live',
      badge: props.liveGameCount && props.liveGameCount > 0
        ? { text: String(props.liveGameCount), tone: 'live' }
        : undefined,
    },
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
    { key: 'portfolio', label: 'Portfolio', glyph: '◈', href: inLeague('/core/portfolio') },
    // 21a's My Leagues and the connect/re-sync dashboard it links to. League
    // Sync is the ONLY entry point to the Yahoo OAuth handoff and per-league
    // re-sync, so the shell must reach it or the /core cutover quietly removes
    // both.
    { key: 'my-leagues', label: 'My Leagues', glyph: '▦', href: '/leagues' },
    { key: 'league-sync', label: 'League Sync', glyph: '⟳', href: '/leagues/sync' },
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
    // 38a adds a one-league career view on this same key — titles, record and
    // grades *inside* this league. The cross-league trophy room is still what
    // renders without a league.
    {
      key: 'career',
      label: 'Your career',
      glyph: '★',
      href: props.selectedLeagueId
        ? `/core/career?league=${encodeURIComponent(props.selectedLeagueId)}`
        : '/core/career',
    },
    // 26b — replaces the dashboard entry that pointed at /af-legacy?tab=pulse.
    // 38a scopes it to one league's full standings table when a league is held.
    /*
     * League points-for board. League-scoped only — a cross-league points total
     * is not a thing, because two leagues' scoring settings make their point
     * values incomparable.
     */
    {
      key: 'standings',
      label: 'Standings',
      glyph: '≡',
      href: props.selectedLeagueId
        ? `/core/standings?league=${encodeURIComponent(props.selectedLeagueId)}`
        : '/core/standings',
    },
    {
      key: 'season-outlook',
      label: 'Season Outlook',
      glyph: '◎',
      href: props.selectedLeagueId
        ? `/core/season-outlook?league=${encodeURIComponent(props.selectedLeagueId)}`
        : '/core/season-outlook',
    },
    {
      key: 'rankings',
      label: 'Rankings',
      glyph: '↑',
      href: inLeague('/core/rankings'),
      // Only shown when a level actually exists — never a placeholder "LVL 1".
      badge: props.rankingsLevel != null ? { text: `LVL ${props.rankingsLevel}`, tone: 'level' } : undefined,
    },
    /*
     * 38a·9 — ABSENT for anyone who commissions nothing, not disabled.
     *
     * ⚠ THIS ENTRY USED TO RENDER FOR EVERY USER AND LAND ON "this screen has
     * not been built yet". Now that it lands on a real admin surface, showing
     * it to a plain member would advertise a feature they cannot open — and a
     * greyed-out control leaks the same information a drawn one does. The
     * handoff's rule is absence over disabled state, so the item is simply not
     * built when the count is zero.
     *
     * The count is "leagues you run", which is what a global nav item can
     * honestly reflect. Whether you run the league currently selected is a
     * different question, decided server-side by `getCommissionerHub` on every
     * render — this is a nav affordance, never the gate.
     */
    ...(props.commissionerCount && props.commissionerCount > 0
      ? [
          {
            key: 'commissioner' as const,
            label: 'Commissioner',
            glyph: '⚑',
            href: props.selectedLeagueId
              ? `/core/commissioner?league=${encodeURIComponent(props.selectedLeagueId)}`
              : '/core/commissioner',
            badge: { text: String(props.commissionerCount), tone: 'count' as const },
          },
        ]
      : []),
    {
      key: 'notifications',
      label: 'Notifications',
      glyph: '◐',
      // 38a filters the feed to one league. Same key, same rows — the league
      // is a filter over `NotificationRow.leagueId`, which the row already has.
      href: props.selectedLeagueId
        ? `/core/notifications?league=${encodeURIComponent(props.selectedLeagueId)}`
        : '/core/notifications',
      // Only when something is actually unread — a badge with nothing behind it
      // is an invented notification, the same rule ChimmyFab follows.
      badge:
        props.notificationCount && props.notificationCount > 0
          ? { text: String(props.notificationCount), tone: 'count' }
          : undefined,
    },
    /*
     * League-scoped only. Without a league this is the account-wide connections
     * page's job, and the nav sends you there rather than to an empty shell.
     */
    {
      key: 'sync',
      label: 'Sync',
      glyph: '↻',
      href: props.selectedLeagueId
        ? `/core/sync?league=${encodeURIComponent(props.selectedLeagueId)}`
        : '/leagues/sync',
    },
    { key: 'tools', label: 'Tools', glyph: '⚙', href: inLeague('/core/tools') },
    // Full page outside /core, like My Leagues and League Sync above. This is
    // where appearance mode and language live (Settings → Preferences), and
    // the rail's bottom profile tile was the only way there — a single-letter
    // tile nobody reads as "settings". Deep-links straight to the Preferences
    // tab because mode/language is what people come here for; the other tabs
    // stay one click away in the settings chrome. Not ⚙: Tools owns that
    // glyph, and two identical marks in one nav was exactly the mistake the
    // Career entry above had to fix.
    { key: 'settings', label: 'Settings', glyph: '◧', href: '/settings?tab=preferences' },
  ]
}

/**
 * The order the sections appear in, and which keys belong to each.
 *
 * Declared as key lists rather than by rebuilding the items so `navItems` stays
 * the single place an item's label, glyph, href and badge are defined — a nav
 * entry that exists in two places drifts in one of them.
 *
 * Any key not named here still renders, in a trailing unheaded group, so adding
 * a nav item can never silently drop it off the rail.
 */
const NAV_SECTIONS: Array<{ id: string; heading: string | null; keys: CoreNavKey[] }> = [
  { id: 'top', heading: null, keys: ['home'] },
  {
    id: 'league',
    heading: 'This league',
    keys: ['my-team', 'matchup', 'waivers', 'trades', 'players', 'draft-hq', 'war-room'],
  },
  { id: 'now', heading: 'This week', keys: ['week', 'live', 'standings', 'season-outlook'] },
  { id: 'history', heading: 'Your record', keys: ['career', 'rankings', 'portfolio'] },
  {
    id: 'manage',
    heading: 'Manage',
    /*
     * 'sync' is THIS league's freshness; 'league-sync' is the account-wide
     * connect / OAuth / add-league page. Both are real and neither replaces
     * the other, so both are listed rather than one quietly shadowing it.
     */
    keys: ['commissioner', 'notifications', 'sync', 'my-leagues', 'league-sync', 'settings', 'tools'],
  },
]

function navSections(props: AfCoreShellProps): NavSection[] {
  const items = navItems(props)
  const byKey = new Map(items.map((i) => [i.key, i]))
  const placed = new Set<CoreNavKey>()

  const sections: NavSection[] = NAV_SECTIONS.map((s) => {
    const picked = s.keys.flatMap((k) => {
      const item = byKey.get(k)
      if (!item) return []
      placed.add(k)
      return [item]
    })
    return { id: s.id, heading: s.heading, items: picked }
  }).filter((s) => s.items.length > 0)

  const leftover = items.filter((i) => !placed.has(i.key))
  if (leftover.length > 0) sections.push({ id: 'other', heading: null, items: leftover })

  return sections
}

/**
 * The phone's bottom bar.
 *
 * ⚠ A HORIZONTAL SCROLLER IS NOT A PHONE NAV. Below 720px the primary nav
 * became a strip you had to swipe sideways through nineteen items to reach
 * anything past the fifth — reachable, but only in the sense that a directory
 * is reachable. These five are the destinations a phone session actually starts
 * from, pinned where a thumb reaches, and "More" opens the full strip rather
 * than hiding the rest.
 *
 * `home` is included even when a league is selected: on a phone the league
 * switcher is off-screen, so the way back to the league list has to be here.
 */
const MOBILE_BAR_KEYS: CoreNavKey[] = ['home', 'my-team', 'week', 'live', 'notifications']

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

/**
 * A league or profile image on a rail tile, falling back to the letter it would
 * otherwise render. Same pattern as Dashboard3A's `Mark`: `useState` rather
 * than a plain `onError` src swap, because a broken-image glyph left in place
 * is worse than the letter it replaces — the Sleeper CDN 404s for some avatar
 * ids. `alt` is empty on purpose: the wrapping link already carries the
 * accessible name, and doubling it reads the league name twice.
 */
function RailMark({ src, letter }: { src: string | null | undefined; letter: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <>{letter}</>
  return <img src={src} alt="" className="af-rail-tile-img" onError={() => setFailed(true)} loading="lazy" />
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
  const sections = useMemo(() => navSections(props), [props])
  const mobileItems = useMemo(() => {
    const byKey = new Map(navItems(props).map((i) => [i.key, i]))
    return MOBILE_BAR_KEYS.flatMap((k) => {
      const item = byKey.get(k)
      return item ? [item] : []
    })
  }, [props])
  const { leagues, syncAge, plan, weekLabel, active, children, comms } = props
  // "More" is current whenever the screen you are on is not one of the five
  // pinned ones — otherwise the bar shows nothing as active and reads broken.
  const activeInBar = mobileItems.some((i) => i.key === active)

  return (
    <div className="af-core af-shell">
      {/*
        Keyboard users land on the rail, then the nav, then the search box —
        three groups and roughly thirty tabbable controls — before reaching the
        screen they navigated to. This is the standard fix and it costs nothing
        visually: it is off-screen until focused.
      */}
      <a href="#af-content" className="af-skip">
        Skip to content
      </a>

      {/* ── League rail ─────────────────────────────────────────────── */}
      <nav className="af-rail" aria-label="Leagues">
        {/*
          The crest, above the leagues, drawn rather than loaded — see
          AfCrest's header for why /af-crest.png cannot sit on a dark rail.
        */}
        <Link href="/core" className="af-rail-logo" aria-label="AllFantasy home">
          <AfCrest size={34} />
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
            <RailMark src={l.imageUrl} letter={l.mark} />
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
          {/*
           * ⚠ THIS WAS A HARDCODED 'G' — every account saw the same letter
           * regardless of who was signed in. Now: the account's own image when
           * one is stored, the display-name initial when not, and a neutral
           * mark when the account has neither. Array.from, not slice: a name
           * starting with an emoji sliced mid-surrogate serialises differently
           * on server and client and takes hydration down (same trap the 3A
           * initials fix documents).
           */}
          <RailMark
            src={props.profile?.imageUrl}
            letter={(Array.from(props.profile?.name?.trim() || '•')[0] ?? '•').toUpperCase()}
          />
        </Link>
      </nav>

      {/* ── Primary nav ─────────────────────────────────────────────── */}
      <aside className="af-nav" id="af-nav" aria-label="Sections">
        {sections.map((section) => (
          <div className="af-nav-group" key={section.id}>
            {section.heading ? (
              <div className="af-nav-heading af-label" aria-hidden>
                {section.heading}
              </div>
            ) : null}
            {/*
              One <ul> per section so the headings are structure a screen reader
              can use, not decoration between anonymous links. The heading is
              aria-hidden because it is repeated as the list's accessible name —
              announcing it twice is worse than not styling it at all.
            */}
            <ul className="af-nav-items" aria-label={section.heading ?? 'Primary'}>
              {section.items.map((item) => (
                <li key={item.key}>
                  <Link
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
                </li>
              ))}
            </ul>
          </div>
        ))}

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

        <main className="af-content" id="af-content" tabIndex={-1}>
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
      {/* ── Phone bottom bar ────────────────────────────────────────── */}
      <nav className="af-tabbar" aria-label="Main">
        {mobileItems.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className="af-tabbar-item"
            data-active={item.key === active}
            aria-current={item.key === active ? 'page' : undefined}
          >
            <span className="af-tabbar-glyph" aria-hidden>
              {item.glyph}
              {item.badge ? <span className="af-tabbar-dot" data-tone={item.badge.tone} /> : null}
            </span>
            <span className="af-tabbar-label">{item.label}</span>
          </Link>
        ))}
        {/*
          Anchors to the nav strip rather than opening a sheet. The strip is
          already on the page and already scrollable, so a sheet would be a
          second copy of the same list — one more thing to keep in step with
          navItems for no gain.
        */}
        <a className="af-tabbar-item" href="#af-nav" data-active={!activeInBar}>
          <span className="af-tabbar-glyph" aria-hidden>
            ⋯
          </span>
          <span className="af-tabbar-label">More</span>
        </a>
      </nav>

      {comms ? (
        <CommsDock
          leagues={comms.leagues}
          pageLeagueId={props.selectedLeagueId ?? null}
          chimmyTokenCost={comms.chimmyTokenCost}
          homeSignals={comms.homeSignals ?? null}
          dockable={comms.dockable}
          supportEmail={comms.supportEmail}
          unread={comms.unread ?? 0}
          mentions={comms.mentions ?? 0}
        />
      ) : null}
    </div>
  )
}

export default AfCoreShell
