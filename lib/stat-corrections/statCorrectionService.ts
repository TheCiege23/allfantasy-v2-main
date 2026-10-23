/**
 * The commissioner's read of the stat-correction review (statCorrectionDetector.ts): the latest
 * stored review for the league's current season, with team names attached. Read-only.
 */
import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import type { MatchupCorrection, PlayerCorrection } from './statCorrectionReview'
import { readStoredReview, STAT_CORRECTION_WINDOW_MS, statCorrectionCacheKeyPrefix } from './statCorrectionDetector'

export type StatCorrectionView = {
  /** False when the league is outside what the review covers (see the detector's scope note). */
  covered: boolean
  latest: null | {
    season: number
    week: number
    checkedAt: string
    /** Re-checks stop after this; a correction posted later is not picked up. */
    windowClosesAt: string
    unchecked: number
    changes: Array<PlayerCorrection & { teamName: string }>
    matchups: Array<
      MatchupCorrection & { home: MatchupCorrection['home'] & { teamName: string }; away: MatchupCorrection['away'] & { teamName: string } }
    >
  }
}

export async function readStatCorrections(leagueId: string): Promise<StatCorrectionView> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, platform: true } })
  const covered = String(league?.sport ?? '').toUpperCase() === 'NFL' && resolveWriteAuthority(league?.platform) === 'NATIVE'
  if (!league || !covered) return { covered: false, latest: null }

  const season = await prisma.redraftSeason.findFirst({ where: { leagueId }, orderBy: { season: 'desc' }, select: { id: true } })
  if (!season) return { covered, latest: null }
  const rows = await prisma.sportsDataCache.findMany({
    where: { cacheKey: { startsWith: statCorrectionCacheKeyPrefix(season.id) } },
    select: { data: true },
  })
  const stored = rows
    .map((r) => readStoredReview(r.data))
    .filter((r): r is NonNullable<typeof r> => r !== null && r.leagueId === leagueId)
    .sort((a, b) => b.week - a.week)[0]
  if (!stored) return { covered, latest: null }

  const { review } = stored
  const rosterIds = [...new Set([...review.changes.map((c) => c.rosterId), ...review.matchups.flatMap((m) => [m.home.rosterId, m.away.rosterId])])]
  const rosters = rosterIds.length
    ? await prisma.redraftRoster.findMany({ where: { id: { in: rosterIds }, leagueId }, select: { id: true, teamName: true, ownerName: true } })
    : []
  const names = new Map(rosters.map((r) => [r.id, r.teamName?.trim() || r.ownerName || 'Team']))
  const teamName = (id: string) => names.get(id) ?? 'Team'

  return {
    covered,
    latest: {
      season: stored.season,
      week: stored.week,
      checkedAt: stored.checkedAt,
      windowClosesAt: new Date(Date.parse(stored.sealedAt) + STAT_CORRECTION_WINDOW_MS).toISOString(),
      unchecked: review.unchecked,
      changes: review.changes.map((c) => ({ ...c, teamName: teamName(c.rosterId) })),
      matchups: review.matchups.map((m) => ({
        ...m,
        home: { ...m.home, teamName: teamName(m.home.rosterId) },
        away: { ...m.away, teamName: teamName(m.away.rosterId) },
      })),
    },
  }
}
