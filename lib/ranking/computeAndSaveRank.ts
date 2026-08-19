import { prisma } from '@/lib/prisma'
import type { LegacyLeagueHistoryRow, LegacyTotals, RankPreview } from '@/lib/ranking/computeLegacyRank'
import { computeLegacyRankPreview } from '@/lib/ranking/computeLegacyRank'
import { calculateAndSaveRank } from '@/lib/rank/calculateRank'

type LegacyUserRef = { id: string } | null | undefined

function safeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export async function computeAndSaveRank(
  afUserId: string,
  legacyUserRef?: LegacyUserRef
): Promise<void> {
  const legacyUserId =
    legacyUserRef?.id ??
    (
      await prisma.appUser.findUnique({
        where: { id: afUserId },
        select: { legacyUserId: true },
      })
    )?.legacyUserId

  if (!legacyUserId) return

  const legacyUser = await prisma.legacyUser.findUnique({
    where: { id: legacyUserId },
    select: {
      id: true,
      sleeperUserId: true,
      leagues: {
        orderBy: [{ season: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          season: true,
          sport: true,
          leagueType: true,
          scoringType: true,
          teamCount: true,
          winnerRosterId: true,
          playoffTeams: true,
          rosters: {
            select: {
              rosterId: true,
              ownerId: true,
              isOwner: true,
              wins: true,
              losses: true,
              ties: true,
              playoffSeed: true,
              finalStanding: true,
              isChampion: true,
            },
          },
        },
      },
    },
  })

  if (!legacyUser) return

  const rosterByLeagueId = new Map(
    legacyUser.leagues
      .map((league) => {
        const byOwnerId =
          league.rosters.find((roster) => roster.ownerId != null && String(roster.ownerId) === String(legacyUser.sleeperUserId)) ?? null
        const byOwnership = league.rosters.find((roster) => roster.isOwner) ?? null
        const roster = byOwnerId ?? byOwnership
        return roster ? ([league.id, roster] as const) : null
      })
      .filter((entry): entry is readonly [string, (typeof legacyUser.leagues)[number]['rosters'][number]] => entry != null)
  )

  const leagueHistory: LegacyLeagueHistoryRow[] = legacyUser.leagues.map((league) => {
    const roster = rosterByLeagueId.get(league.id)
    const wins = safeNumber(roster?.wins)
    const losses = safeNumber(roster?.losses)
    const ties = safeNumber(roster?.ties)
    const playoffTeams = safeNumber(league.playoffTeams)
    const finalStanding = roster?.finalStanding != null ? safeNumber(roster.finalStanding) : null
    const playoffSeed = roster?.playoffSeed != null ? safeNumber(roster.playoffSeed) : null
    const fallbackChampion =
      roster != null &&
      league.winnerRosterId != null &&
      safeNumber(league.winnerRosterId) === safeNumber(roster.rosterId)
    const isChampion = Boolean(roster?.isChampion) || fallbackChampion
    const madePlayoffs =
      (playoffSeed != null && playoffSeed > 0) ||
      isChampion ||
      (playoffTeams > 0 && finalStanding != null && finalStanding > 0 && finalStanding <= playoffTeams)

    return {
      season: league.season,
      sport: league.sport,
      type: league.leagueType,
      scoring: league.scoringType,
      team_count: league.teamCount,
      wins,
      losses,
      ties,
      made_playoffs: madePlayoffs,
      is_champion: isChampion,
    }
  })

  const seasonsImported = new Set(legacyUser.leagues.map((league) => league.season)).size || 1
  const rosterRows = Array.from(rosterByLeagueId.values())

  const totals: LegacyTotals = {
    seasons_imported: seasonsImported,
    leagues_played: rosterRows.length,
    wins: rosterRows.reduce((sum, roster) => sum + safeNumber(roster.wins), 0),
    playoffs: leagueHistory.reduce((sum, league) => sum + (league.made_playoffs ? 1 : 0), 0),
    championships: leagueHistory.reduce((sum, league) => sum + (league.is_champion ? 1 : 0), 0),
  }

  const rankPreview: RankPreview = computeLegacyRankPreview({
    totals,
    leagueHistory,
  })

  const now = new Date()

  await prisma.legacyUserRankCache.upsert({
    where: { legacyUserId: legacyUser.id },
    create: {
      legacyUserId: legacyUser.id,
      careerXp: BigInt(rankPreview.career.xp),
      careerLevel: rankPreview.career.level,
      careerTier: rankPreview.career.tier,
      careerTierName: rankPreview.career.tier_name,
      baselineYearXp: BigInt(rankPreview.yearly_projection.baseline_year_xp),
      aiLowYearXp: BigInt(rankPreview.yearly_projection.ai_low_year_xp),
      aiMidYearXp: BigInt(rankPreview.yearly_projection.ai_mid_year_xp),
      aiHighYearXp: BigInt(rankPreview.yearly_projection.ai_high_year_xp),
      assumptionsJson: rankPreview.yearly_projection.assumptions,
      lastCalculatedAt: now,
      lastRefreshAt: now,
      computedFromImportCompletedAt: now,
    },
    update: {
      careerXp: BigInt(rankPreview.career.xp),
      careerLevel: rankPreview.career.level,
      careerTier: rankPreview.career.tier,
      careerTierName: rankPreview.career.tier_name,
      baselineYearXp: BigInt(rankPreview.yearly_projection.baseline_year_xp),
      aiLowYearXp: BigInt(rankPreview.yearly_projection.ai_low_year_xp),
      aiMidYearXp: BigInt(rankPreview.yearly_projection.ai_mid_year_xp),
      aiHighYearXp: BigInt(rankPreview.yearly_projection.ai_high_year_xp),
      assumptionsJson: rankPreview.yearly_projection.assumptions,
      lastCalculatedAt: now,
      lastRefreshAt: now,
      computedFromImportCompletedAt: now,
    },
  })

  // Reconciliation: user_profiles is owned by the single canonical engine
  // (calculateAndSaveRank) — imported (all platforms) + legacy + native AF leagues,
  // one XP scale. This engine keeps its own legacyUserRankCache (yearly projections)
  // above but no longer writes a divergent user_profiles scale, which is what made
  // the displayed career rank non-deterministic.
  await calculateAndSaveRank(afUserId)
}
