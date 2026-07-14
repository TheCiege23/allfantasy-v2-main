/**
 * Canonical imported-league lifecycle completion. Provider-agnostic by
 * construction — reads only the already-canonical `League`/`LeagueTeam`
 * tables every provider's commit path already writes to
 * (`bootstrapLeagueFromNormalizedImport`), not any provider-specific
 * payload. No provider branch exists or is needed here.
 *
 * Scope, stated honestly: this does NOT touch the renewal engine
 * (`lib/redraft/renewal/**`) and does not create a second lifecycle
 * system. It materializes the exact same `RedraftSeason`/`RedraftRoster`
 * models the renewal engine already uses, so every downstream consumer
 * that reads those tables (Trade Decision OS today; potentially Waiver/
 * Draft/Playoff engines later) works identically whether a league was
 * created natively, drafted, renewed, or imported from any provider.
 */
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

export interface CanonicalSeasonMaterializationResult {
  seasonId: string | null
  created: boolean
  rosterCount: number
  skippedReason?: 'LEAGUE_NOT_FOUND' | 'UNSUPPORTED_SPORT' | 'NO_TEAMS'
}

/**
 * Idempotent: a second call for the same league/season returns the existing
 * `RedraftSeason` id without creating a duplicate. Safe to call from any
 * import commit path (new or `allowUpdateExisting` re-commit) and to retry
 * after a partial failure — never throws; a failure here must never fail
 * the overall league import (matches the existing best-effort pattern used
 * by every other post-commit bootstrap step in
 * `ImportedLeagueCommitService.ts`).
 */
export async function materializeRedraftSeasonForImportedLeague(
  leagueId: string,
): Promise<CanonicalSeasonMaterializationResult> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, sport: true, season: true, status: true, playoffStartWeek: true },
  })
  if (!league) return { seasonId: null, created: false, rosterCount: 0, skippedReason: 'LEAGUE_NOT_FOUND' }

  const sport = normalizeToSupportedSport(league.sport)
  if (sport !== 'NFL' && sport !== 'NCAAF') {
    return { seasonId: null, created: false, rosterCount: 0, skippedReason: 'UNSUPPORTED_SPORT' }
  }
  const seasonYear = league.season ?? new Date().getFullYear()

  const existing = await prisma.redraftSeason.findUnique({
    where: { leagueId_season: { leagueId, season: seasonYear } },
  })
  if (existing) {
    const rosterCount = await prisma.redraftRoster.count({ where: { seasonId: existing.id } })
    return { seasonId: existing.id, created: false, rosterCount }
  }

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId },
    select: {
      id: true,
      ownerName: true,
      teamName: true,
      avatarUrl: true,
      platformUserId: true,
      wins: true,
      losses: true,
      ties: true,
      pointsFor: true,
      currentRank: true,
    },
  })
  if (teams.length === 0) {
    return { seasonId: null, created: false, rosterCount: 0, skippedReason: 'NO_TEAMS' }
  }

  // Real Sleeper/ESPN/etc. status vocabularies all include a 'complete'
  // value; anything else (in_season/pre_draft/drafting/unset) is treated
  // as an active, in-progress season — an imported league is, by
  // definition, already past setup/pre_draft in the source platform.
  const seasonStatus = league.status === 'complete' ? 'complete' : 'in_season'
  const playoffStartWeek = league.playoffStartWeek ?? 15
  const totalWeeks = Math.max(playoffStartWeek - 1, 1)

  const season = await prisma.redraftSeason.create({
    data: {
      leagueId,
      sport,
      season: seasonYear,
      status: seasonStatus,
      totalWeeks,
      playoffStartWeek,
      currentWeek: seasonStatus === 'complete' ? totalWeeks : 1,
    },
  })

  const rosters = await Promise.all(
    teams.map((t) =>
      prisma.redraftRoster.create({
        data: {
          seasonId: season.id,
          leagueId,
          // Real provider manager id when known; falls back to the
          // LeagueTeam's own id for orphaned/unclaimed teams — never
          // fabricated as a real AppUser id, matching the same fallback
          // `bootstrapLeagueFromNormalizedImport` already uses for
          // `Roster.platformUserId`.
          ownerId: t.platformUserId || t.id,
          ownerName: t.ownerName,
          teamName: t.teamName,
          avatarUrl: t.avatarUrl,
          wins: t.wins ?? 0,
          losses: t.losses ?? 0,
          ties: t.ties ?? 0,
          pointsFor: t.pointsFor ?? 0,
          playoffSeed: t.currentRank ?? null,
        },
      }),
    ),
  )

  return { seasonId: season.id, created: true, rosterCount: rosters.length }
}
