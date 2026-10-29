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
 * Mirrors the tick's SQL (`leagueType: 'redraft'`, `isDynasty: false`, sport in the list) plus its
 * in-code filter (not survivor, not guillotine, native platform). A missing league, type, dynasty
 * flag or sport reads as false, which keeps the toggle visible: a no-op toggle is safer than a
 * hidden live one. A missing platform is native, exactly as `resolveWriteAuthority` treats it on
 * the server.
 */
export function startsAtScheduledTimeRegardlessOfAutostart(league: ScheduledStartLeague | null | undefined): boolean {
  if (!league) return false
  if (league.leagueType !== 'redraft' || league.isDynasty !== false) return false
  if (!(SCHEDULED_REDRAFT_SPORTS as readonly string[]).includes(String(league.sport ?? ''))) return false
  if (league.survivorMode === true || league.guillotineMode === true || league.leagueVariant === 'guillotine') return false
  return resolveWriteAuthority(league.platform) === 'NATIVE'
}
