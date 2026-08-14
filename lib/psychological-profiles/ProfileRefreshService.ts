import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { runPsychologicalProfileEngine } from './PsychologicalProfileEngine'

/**
 * ProfileRefreshService — generate psychological profiles for a whole league.
 *
 * The engine has existed and been reachable for a while, and `manager_psych_profiles`
 * still held 0 rows, because nothing ever invoked it outside a manual route.
 *
 * DELIBERATELY AFTER SYNC, NOT AT IMPORT. A league that has just been imported
 * has no history until its first sync finishes — profiling at import would
 * characterise every manager from an empty roster and, with the evidence floor
 * in place, simply produce nothing useful while burning the work. Running once
 * the sync has landed real drafts, trades and rosters is what makes a profile
 * mean anything.
 *
 * Bounded and failure-contained: profiling is enrichment, and must never take
 * down the sync it rides along with.
 */

export type LeagueProfileRefreshResult = {
  leagueId: string
  sport: string
  season: number
  managersConsidered: number
  profiled: number
  failed: number
  errors: string[]
}

export async function refreshLeagueProfiles(input: {
  leagueId: string
  sport?: string
  season?: number
  /** Cap managers per run so one large league cannot dominate a cron tick. */
  limit?: number
}): Promise<LeagueProfileRefreshResult> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    include: { teams: true },
  })

  const sport = normalizeToSupportedSport(input.sport ?? league?.sport ?? 'NFL')
  const season = input.season ?? league?.season ?? new Date().getFullYear()

  const result: LeagueProfileRefreshResult = {
    leagueId: input.leagueId,
    sport,
    season,
    managersConsidered: 0,
    profiled: 0,
    failed: 0,
    errors: [],
  }
  if (!league) {
    result.errors.push('league not found')
    return result
  }

  const teams = typeof input.limit === 'number' ? league.teams.slice(0, input.limit) : league.teams
  result.managersConsidered = teams.length

  for (const team of teams) {
    const managerId = team.externalId || team.id
    if (!managerId) continue
    try {
      await runPsychologicalProfileEngine({
        leagueId: input.leagueId,
        managerId,
        sport,
        season,
        sleeperUsername: team.ownerName ?? undefined,
        rosterId: undefined,
      })
      result.profiled += 1
    } catch (e) {
      result.failed += 1
      if (result.errors.length < 5) {
        result.errors.push(
          `${team.ownerName ?? managerId}: ${(e instanceof Error ? e.message : String(e)).slice(0, 90)}`,
        )
      }
    }
  }

  return result
}

/**
 * Refresh profiles for the leagues behind a set of just-synced Sleeper league ids.
 *
 * Sync speaks in EXTERNAL (Sleeper) league ids; the profile engine is keyed by
 * canonical `League.id`. One external league can map to several canonical rows,
 * so every match is profiled rather than the first one found.
 */
export async function refreshProfilesForExternalLeagues(input: {
  externalLeagueIds: string[]
  /** Cap total leagues touched per tick. */
  maxLeagues?: number
  managersPerLeague?: number
}): Promise<{ leaguesProfiled: number; managersProfiled: number; results: LeagueProfileRefreshResult[] }> {
  const ids = [...new Set(input.externalLeagueIds.filter(Boolean))]
  if (ids.length === 0) return { leaguesProfiled: 0, managersProfiled: 0, results: [] }

  const leagues = await prisma.league.findMany({
    where: { platformLeagueId: { in: ids } },
    select: { id: true, sport: true, season: true },
    take: input.maxLeagues ?? 10,
  })

  const results: LeagueProfileRefreshResult[] = []
  for (const league of leagues) {
    const r = await refreshLeagueProfiles({
      leagueId: league.id,
      sport: league.sport ?? undefined,
      season: league.season ?? undefined,
      limit: input.managersPerLeague,
    })
    results.push(r)
  }

  return {
    leaguesProfiled: results.length,
    managersProfiled: results.reduce((a, r) => a + r.profiled, 0),
    results,
  }
}
