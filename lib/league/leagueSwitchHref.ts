/**
 * Switching league keeps the page you are on (owner, 2026-11-19): "if I choose another league, the same page I'm on in
 * the current one, whether it's trade or league or roster, should show on the next league".
 *
 * Two shells hold a league's pages. A native (AllFantasy-hosted) league is `/league/<id>?view=<tab id>`
 * (app/league/[leagueId]/LeagueShell.tsx); an imported one is `/core/<screen>?league=<id>`
 * (components/core-app/AfCoreShell.tsx). A switch can cross from one to the other, so a page is carried as the pair
 * below. A page with no counterpart (a format's own screen, League home, a cross-league screen) opens the league's front
 * page, which is what every switch did before.
 *
 * Pure: no React, no Prisma.
 */
import { isNativePlatform } from '@/lib/league/isNativeLeague'

/** Native tab id → the /core screen showing the same thing. */
const CORE_SCREEN_FOR_VIEW: Record<string, string> = {
  matchups: 'matchup',
  matchup: 'matchup',
  scores: 'live',
  roster: 'my-team',
  team: 'my-team',
  waivers: 'waivers',
  players: 'players',
  trades: 'trades',
  // Decision OS replaced the Season Outlook screen (lib/league/nativeLeagueNavigation.ts).
  decide: 'season-outlook',
  standings: 'standings',
  schedule: 'schedule',
  war_room: 'war-room',
  draft: 'draft-hq',
  settings: 'league-settings',
  commissioner: 'commissioner',
}

/** /core screen → the native tab id showing the same thing. */
const VIEW_FOR_CORE_SCREEN: Record<string, string> = {
  matchup: 'matchups',
  live: 'matchups',
  'my-team': 'roster',
  waivers: 'waivers',
  players: 'players',
  trades: 'trades',
  'season-outlook': 'decide',
  standings: 'standings',
  schedule: 'schedule',
  'war-room': 'war_room',
  'draft-hq': 'draft',
  'league-settings': 'settings',
  commissioner: 'commissioner',
}

/** The page being left: a native tab id, or a /core screen key. */
export type CurrentLeaguePage = { view: string } | { coreScreen: string }

type LeagueRow = { id: string; platform?: string | null }

/** Where to send someone switching to `league` from `page`, keeping the page when the target can show it. */
export function leagueSwitchHref(league: LeagueRow, page: CurrentLeaguePage | null): string {
  const id = encodeURIComponent(league.id)
  const native = isNativePlatform(league.platform?.trim())
  if (native) {
    const view = !page ? null : 'view' in page ? page.view : VIEW_FOR_CORE_SCREEN[page.coreScreen] ?? null
    return view ? `/league/${id}?view=${encodeURIComponent(view)}` : `/league/${id}`
  }
  const screen = !page ? null : 'view' in page ? CORE_SCREEN_FOR_VIEW[page.view] ?? null : page.coreScreen in VIEW_FOR_CORE_SCREEN ? page.coreScreen : null
  return screen ? `/core/${screen}?league=${id}` : `/core?league=${id}`
}
