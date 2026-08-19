import type { LucideIcon } from 'lucide-react'
import {
  Home, Users, User, Swords, Search, RefreshCw, ArrowLeftRight, ClipboardList,
  BarChart3, Award, Crown, Mail, MessageSquare, Settings,
} from 'lucide-react'

/**
 * Left-nav / drawer / tab-bar destinations, in design order.
 *
 * Icons are `lucide-react` rather than the reference's hand-inlined SVG: lucide *is* the
 * feather geometry the handoff specifies ("simple stroke-based, feather-icons-style"), it's
 * already this repo's icon library, and it keeps the three navs (sidebar, drawer, tab bar)
 * rendering from one source instead of three copies of the same path data.
 *
 * ⚠ Every `href` here is a route that actually exists — verified against `app/`. The design
 * names several destinations this app has no page for (My Team, Matchups, Players, Waivers,
 * Trades, League Chat as top-level routes), so each is mapped to its real equivalent rather
 * than shipping nav that 404s. Two cases are special:
 *  - `requiresLeague` items live under `/league/[leagueId]/…`, so they need a selected league
 *    with a unified record; without one the item renders disabled instead of linking nowhere.
 *  - `/leagues` is the real "My Leagues" index; the design's "League Home" is that page.
 */

export type NavItem = {
  key: string
  label: string
  Icon: LucideIcon
  /** Static destination. Omitted for league-scoped items, which build their href at render. */
  href?: string
  /** Builds an href from the selected league. Item is disabled when no league is selected. */
  leagueHref?: (leagueId: string) => string
  requiresLeague?: boolean
  /** Only rendered for commissioners. */
  commissionerOnly?: boolean
  badge?: { kind: 'count' | 'live' | 'new'; countKey?: BadgeCountKey; text?: string }
  /** Shown in the mobile bottom tab bar (max 4 + "More"). */
  mobileTab?: boolean
}

/** Badge counts the dashboard can source for real. Anything not listed renders no badge. */
export type BadgeCountKey = 'waivers' | 'trades' | 'messages'

export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', Icon: Home, href: '/dashboard/v2', mobileTab: true },
  { key: 'leagues', label: 'My Leagues', Icon: Users, href: '/leagues', mobileTab: true },
  { key: 'team', label: 'My Team', Icon: User, href: '/war-room' },
  {
    key: 'matchups', label: 'Matchups', Icon: Swords,
    leagueHref: (id) => `/league/${id}/matchups`, requiresLeague: true,
  },
  { key: 'players', label: 'Players', Icon: Search, href: '/player-values' },
  {
    key: 'waivers', label: 'Waivers', Icon: RefreshCw, href: '/waiver-wire',
    badge: { kind: 'count', countKey: 'waivers' },
  },
  {
    key: 'trades', label: 'Trades', Icon: ArrowLeftRight, href: '/trade-analyzer',
    badge: { kind: 'count', countKey: 'trades' },
  },
  { key: 'draft', label: 'Draft', Icon: ClipboardList, href: '/draft', mobileTab: true },
  { key: 'rankings', label: 'Rankings', Icon: BarChart3, href: '/rankings', mobileTab: true },
  { key: 'legacy', label: 'Legacy & Achievements', Icon: Award, href: '/af-legacy' },
  {
    key: 'commissioner', label: 'Commissioner HQ', Icon: Crown, href: '/commissioner-hub',
    commissionerOnly: true, badge: { kind: 'new', text: 'NEW' },
  },
  {
    key: 'messages', label: 'Messages', Icon: Mail, href: '/messages',
    badge: { kind: 'count', countKey: 'messages' },
  },
  { key: 'chat', label: 'League Chat', Icon: MessageSquare, href: '/legacy?tab=chat' },
  { key: 'settings', label: 'Settings', Icon: Settings, href: '/settings' },
]

/**
 * Resolve an item to a usable href, or null when it can't be linked.
 *
 * Returning null (rather than '#' or the bare `/league/`) is deliberate — the caller renders
 * a disabled item, so a user never clicks through to a 404.
 */
export function resolveNavHref(item: NavItem, selectedLeagueId: string | null): string | null {
  if (item.leagueHref) return selectedLeagueId ? item.leagueHref(selectedLeagueId) : null
  return item.href ?? null
}

/** Bottom tab bar: the 4 flagged items plus a "More" button the caller appends. */
export const MOBILE_TABS = NAV_ITEMS.filter((i) => i.mobileTab)
