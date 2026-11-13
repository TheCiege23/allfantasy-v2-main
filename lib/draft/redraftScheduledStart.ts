/**
 * Which leagues' drafts start at their scheduled time whatever "Autostart Draft" says.
 *
 * `startScheduledRedraftDrafts` (the minute draft tick) starts every scheduled native redraft
 * draft in NFL, NBA, NHL and MLB at its time (owner's decision, 2026-10-20), so for those
 * leagues the Autostart toggle does nothing and the settings UI hides it. Survivor and
 * Guillotine leagues are started by `startScheduledSurvivorDrafts`, which still honours the
 * toggle; every other league keeps it too.
 *
 * Pure and client-safe (no prisma, no server-only): the tick and the settings panels share
 * this one predicate so the UI cannot drift from what the server does.
 */

import { resolveWriteAuthority } from '@/lib/league/write-authority'

/** Redraft sports whose scheduled drafts start on the server. */
export const SCHEDULED_REDRAFT_SPORTS = ['NFL', 'NBA', 'NHL', 'MLB'] as const

/**
 * League types whose scheduled draft starts at its time, whatever "Autostart Draft" says.
 *
 * 🛑 CLASSIC BEST BALL WAS IN NEITHER STARTER. It is stored as `leagueType: 'best_ball'`, which the
 * redraft tick's `leagueType: 'redraft'` filter skipped, and it is not Survivor or Guillotine, which the
 * other starter covers. A Classic Best Ball draft therefore waited for the commissioner to press Start,
 * in the one format where the draft is the whole season. It is a standalone seasonal draft exactly like
 * redraft, so it takes redraft's rule (owner's decision, 2026-10-20): the draft time is the commitment.
 * Guilly + Best Ball is a guillotine league and stays with the Survivor/Guillotine starter.
 */
export const SCHEDULED_SEASONAL_LEAGUE_TYPES = ['redraft', 'best_ball'] as const

export type ScheduledStartLeague = {
  sport?: string | null
  leagueType?: string | null
  isDynasty?: boolean | null
  platform?: string | null
  survivorMode?: boolean | null
  guillotineMode?: boolean | null
  leagueVariant?: string | null
}

/**
 * True when the league's scheduled draft starts at its time regardless of `LeagueSettings.autostart`.
 * Mirrors the tick's SQL (`leagueType` redraft or best ball, `isDynasty: false`, sport in the list) plus its
 * in-code filter (not survivor, not guillotine, native platform). A missing league, type, dynasty
 * flag or sport reads as false, which keeps the toggle visible: a no-op toggle is safer than a
 * hidden live one. A missing platform is native, exactly as `resolveWriteAuthority` treats it on
 * the server.
 */
export function startsAtScheduledTimeRegardlessOfAutostart(league: ScheduledStartLeague | null | undefined): boolean {
  if (!league) return false
  if (!(SCHEDULED_SEASONAL_LEAGUE_TYPES as readonly string[]).includes(String(league.leagueType ?? '')) || league.isDynasty !== false) return false
  if (!(SCHEDULED_REDRAFT_SPORTS as readonly string[]).includes(String(league.sport ?? ''))) return false
  if (league.survivorMode === true || league.guillotineMode === true || league.leagueVariant === 'guillotine') return false
  return resolveWriteAuthority(league.platform) === 'NATIVE'
}
