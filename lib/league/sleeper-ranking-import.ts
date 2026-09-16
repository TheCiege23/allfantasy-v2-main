import { LeagueSport, type Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getLeagueRosters } from '@/lib/sleeper-client'
import { getSleeperAvatarUrl, type SleeperLeague } from '@/lib/league/sleeper-import-process'
import { carryAfOwnedLeagueSettings } from '@/lib/league/afOwnedLeagueSettings'

function getScoringType(league: SleeperLeague): 'ppr' | 'half-ppr' | 'standard' {
  const rec = league.scoring_settings?.rec
  if (rec === 1) return 'ppr'
  if (rec === 0.5) return 'half-ppr'
  return 'standard'
}

/**
 * Ranking-only Sleeper import: persists league rows + import_* stats for XP / career display.
 * Does not sync rosters, matchups, or commentary — those belong to full `processLeague` (hub) imports.
 * Rows are tagged so `isRealLeague` and `/api/league/list` hide them from My Leagues.
 */
export async function upsertSleeperRankingImportLeague(
  leagueData: SleeperLeague,
  userId: string,
  season: number,
  sportLabel: LeagueSport,
  sleeperUserId: string
): Promise<{ leagueId: string } | null> {
  const platformLeagueId = leagueData.league_id?.toString()
  if (!platformLeagueId) return null

  const rosters: unknown = await getLeagueRosters(platformLeagueId).catch(() => [] as unknown)
  const mine = Array.isArray(rosters)
    ? rosters.find((r: { owner_id?: string; co_owners?: string[]; settings?: Record<string, unknown> }) => {
        const oid = r?.owner_id != null ? String(r.owner_id) : ''
        const co = Array.isArray(r?.co_owners) ? r.co_owners.map(String) : []
        return oid === sleeperUserId || co.includes(sleeperUserId)
      })
    : null

  const totalTeams =
    typeof leagueData.total_rosters === 'number' && leagueData.total_rosters >= 1
      ? leagueData.total_rosters
      : typeof leagueData.settings?.num_teams === 'number' && (leagueData.settings as { num_teams?: number }).num_teams! >= 1
        ? (leagueData.settings as { num_teams: number }).num_teams
        : 12

  const playoffTeamsRaw = (leagueData.settings as { playoff_teams?: number } | undefined)?.playoff_teams
  const playoffTeams =
    typeof playoffTeamsRaw === 'number' && playoffTeamsRaw >= 1
      ? playoffTeamsRaw
      : Math.max(1, Math.ceil(totalTeams / 3))

  const settings = (mine?.settings ?? {}) as Record<string, unknown>
  const finalStandingRaw = settings.final_standing ?? settings.rank
  const finalStanding =
    typeof finalStandingRaw === 'number' && Number.isFinite(finalStandingRaw)
      ? finalStandingRaw
      : finalStandingRaw != null
        ? parseInt(String(finalStandingRaw), 10)
        : null
  const wins = typeof settings.wins === 'number' ? settings.wins : Number(settings.wins ?? 0) || 0
  const losses = typeof settings.losses === 'number' ? settings.losses : Number(settings.losses ?? 0) || 0
  const ties = typeof settings.ties === 'number' ? settings.ties : Number(settings.ties ?? 0) || 0
  const madePlayoffs =
    finalStanding != null && Number.isFinite(finalStanding) ? finalStanding <= playoffTeams : false
  const wonChampionship = finalStanding === 1

  const fpts =
    typeof settings.fpts === 'number'
      ? settings.fpts
      : typeof settings.fpts_decimal === 'number'
        ? settings.fpts_decimal
        : null

  const commishId = leagueData.commissioner_id != null ? String(leagueData.commissioner_id) : ''
  const coComm =
    Array.isArray(leagueData.metadata?.co_commissioners) ?
      (leagueData.metadata!.co_commissioners as string[]).map(String)
    : []
  const isSleeperCommissioner =
    commishId === sleeperUserId || coComm.includes(sleeperUserId)

  const baseSettings =
    leagueData.settings && typeof leagueData.settings === 'object'
      ? (leagueData.settings as Record<string, unknown>)
      : {}
  const rankMeta = {
    rankImportOnly: true,
    sleeperCommissioner: isSleeperCommissioner,
    sleeperCommissionerId: commishId || null,
    rankingImportAt: new Date().toISOString(),
  }

  /*
   * The update below replaces `settings` with Sleeper's raw object plus the ranking
   * stamp. Carry AllFantasy's own keys across from the existing row so a ranking
   * refresh cannot unpublish a league or drop its dues tracker — see
   * lib/league/afOwnedLeagueSettings.ts.
   */
  const current = await Promise.resolve()
    .then(() =>
      prisma.league.findUnique({
        where: { userId_platform_platformLeagueId_season: { userId, platform: 'sleeper', platformLeagueId, season } },
        select: { settings: true },
      }),
    )
    .catch(() => null)

  const league = await prisma.league.upsert({
    where: {
      userId_platform_platformLeagueId_season: {
        userId,
        platform: 'sleeper',
        platformLeagueId,
        season,
      },
    },
    update: {
      name: leagueData.name ?? 'Unnamed League',
      avatarUrl: getSleeperAvatarUrl(leagueData.avatar),
      leagueSize: totalTeams,
      sport: sportLabel,
      scoring: getScoringType(leagueData),
      isDynasty: leagueData.settings?.type === 2,
      status: 'ranking_only',
      leagueVariant: 'legacy_summary',
      importWins: wins,
      importLosses: losses,
      importTies: ties,
      importMadePlayoffs: madePlayoffs,
      importWonChampionship: wonChampionship,
      importFinalStanding: finalStanding,
      importPointsFor: fpts,
      isCommissioner: isSleeperCommissioner,
      settings: carryAfOwnedLeagueSettings(current?.settings, { ...baseSettings, ...rankMeta }) as Prisma.InputJsonValue,
    },
    create: {
      userId,
      platform: 'sleeper',
      platformLeagueId,
      name: leagueData.name ?? 'Unnamed League',
      season,
      avatarUrl: getSleeperAvatarUrl(leagueData.avatar),
      leagueSize: totalTeams,
      sport: sportLabel,
      scoring: getScoringType(leagueData),
      isDynasty: leagueData.settings?.type === 2,
      status: 'ranking_only',
      leagueVariant: 'legacy_summary',
      importWins: wins,
      importLosses: losses,
      importTies: ties,
      importMadePlayoffs: madePlayoffs,
      importWonChampionship: wonChampionship,
      importFinalStanding: finalStanding,
      importPointsFor: fpts,
      isCommissioner: isSleeperCommissioner,
      settings: { ...baseSettings, ...rankMeta },
    },
  })

  return { leagueId: league.id }
}
