import 'server-only'

import { prisma } from '@/lib/prisma'
import { loadCareerLedger } from '@/lib/rank/careerLedger'
import {
  buildCareerData,
  normalizeCareerSport,
  NO_CAREER_FILTER,
  settingsLabel,
  type CareerData,
  type CareerFilter,
  type CareerIdentity,
  type CareerRow,
  type CareerSource,
} from '@/lib/core-app/careerModel'
import {
  buildFinalsIndex,
  finalResultFor,
  type DynastyTitleRow,
  type FinalsIndex,
} from '@/lib/core-app/careerFinalsResolve'

export * from '@/lib/core-app/careerModel'

/**
 * Identity and ladder position. Read from the SAME denormalised columns
 * /api/user/rank uses, deliberately — two surfaces disagreeing about someone's
 * level is worse than either being slightly stale.
 *
 * ⚠ ALWAYS READ LIVE, NEVER STORED WITH THE PROFILE. A rename or a rank
 * recalculation changes these without touching any league row, so a stored copy
 * would show yesterday's name under today's history.
 */
export async function loadCareerIdentity(userId: string): Promise<CareerIdentity & { legacyUserId: string | null }> {
  try {
    const [appUser, rows] = await Promise.all([
      prisma.appUser.findUnique({
        where: { id: userId },
        select: { username: true, displayName: true, avatarUrl: true, legacyUserId: true },
      }),
      prisma.$queryRaw<Array<{ xp_total: bigint | number | null }>>`
        SELECT xp_total FROM user_profiles WHERE "userId" = ${userId} LIMIT 1
      `,
    ])
    const raw = rows[0]?.xp_total
    return {
      handle: appUser?.displayName?.trim() || appUser?.username?.trim() || null,
      avatarUrl: appUser?.avatarUrl?.trim() || null,
      xpTotal: raw != null ? Number(raw) : null,
      legacyUserId: appUser?.legacyUserId ?? null,
    }
  } catch (err) {
    console.error('[core-app/career] identity/xp read failed:', err)
    return { handle: null, avatarUrl: null, xpTotal: null, legacyUserId: null }
  }
}

/** Your Career uses the same league-season history as Rankings and Career XP. */
export async function loadCareerRows(
  userId: string,
  legacyUserId: string | null,
): Promise<Omit<CareerSource, 'identity'>> {
  const [ledger, rosterless] = await Promise.all([
    loadCareerLedger([userId]),
    legacyUserId ? Promise.resolve().then(() => prisma.legacyLeague.count({
      where: { userId: legacyUserId, rosters: { none: { isOwner: true } } },
    })).catch(() => 0) : 0,
  ])
  const legacyRosterBySleeperLeague = new Map<string, number>()
  const claimedTeamByLeagueId = new Map<string, string>()
  const names = new Map<string, Map<number, Set<string>>>()
  for (const row of ledger) {
    const name = row.leagueName?.trim().toLowerCase() || 'unnamed league'
    const years = names.get(name) ?? new Map<number, Set<string>>()
    const ids = years.get(row.season) ?? new Set<string>()
    ids.add(row.key)
    years.set(row.season, ids)
    names.set(name, years)
  }
  const ambiguous = new Set([...names].filter(([, years]) => [...years.values()].some((ids) => ids.size > 1)).map(([name]) => name))
  const rows: CareerRow[] = ledger.map((row) => {
    const name = row.leagueName?.trim() || 'Unnamed league'
    const providerId = row.providerLeagueId ?? null
    if (row.platform === 'sleeper' && row.teamExternalId) {
      if (row.source === 'legacy' && providerId) legacyRosterBySleeperLeague.set(providerId, Number(row.teamExternalId))
      else claimedTeamByLeagueId.set(row.refId, row.teamExternalId)
    }
    const teamCount = row.leagueSizeKnown ? row.leagueSize : null
    const leagueType = row.leagueType === 'unknown' ? null : row.leagueType
    const scoringType = row.scoring === 'unknown' ? null : row.scoring
    return {
      source: row.source === 'legacy' ? 'legacy' : row.source === 'standing' ? 'standing' : 'import',
      key: row.key,
      leagueKey: ambiguous.has(name.toLowerCase())
        ? `${row.platform}:${providerId ?? row.refId}`.toLowerCase()
        : name.toLowerCase(),
      leagueName: name,
      platform: row.platform,
      sport: normalizeCareerSport(row.sport),
      season: row.season,
      status: row.completed ? 'complete' : row.status ?? null,
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
      pointsFor: row.pointsFor,
      pointsAgainst: row.pointsAgainst ?? null,
      madePlayoffs: row.madePlayoffs,
      playoffKnown: row.playoffKnown ?? row.wonChampionship,
      isChampion: row.wonChampionship,
      teamCount,
      playoffTeams: row.playoffTeams,
      leagueType,
      scoringType,
      settingsLabel: settingsLabel({ leagueType, scoringType, sport: row.sport, teamCount }),
      refId: row.refId,
      providerLeagueId: providerId,
      counted: row.completed,
      inRollup: row.source !== 'standing',
      survival: row.survival,
    }
  })
  const sleeper = rows.filter((r) => r.platform === 'sleeper')
  const finals = await loadFinalsIndex({
    legacyRosterBySleeperLeague,
    claimedTeamByLeagueId,
    platformLeagueIds: sleeper.map((r) => r.providerLeagueId),
    leagueIds: sleeper.map((r) => r.refId),
  })
  for (const row of sleeper) row.finalResult = finalResultFor(row, finals)

  return { rows, platforms: [...new Set(rows.map((r) => r.platform))].sort(), rosterless }
}

/**
 * The stored Sleeper title games this account's rows can be matched to.
 *
 * ⚠ ONLY THE JSON PATHS THE VERDICT READS. `metadata` also carries each season's matchup
 * history, so selecting the column would pull all of it for every league-season.
 *
 * Never throws: Finals is one tile, and a failed read leaves it "not recorded" rather than
 * taking the career page down.
 */
async function loadFinalsIndex(args: {
  legacyRosterBySleeperLeague: ReadonlyMap<string, number>
  claimedTeamByLeagueId: ReadonlyMap<string, string>
  platformLeagueIds: ReadonlyArray<string | null>
  leagueIds: readonly string[]
}): Promise<FinalsIndex> {
  const { legacyRosterBySleeperLeague, claimedTeamByLeagueId } = args
  const ownership = { legacyRosterBySleeperLeague, claimedTeamByLeagueId }

  const platformIds = [
    ...new Set([...legacyRosterBySleeperLeague.keys(), ...args.platformLeagueIds.filter((id): id is string => !!id)]),
  ]
  const claimedIds = [...args.claimedTeamByLeagueId.keys()]
  const leagueIds = [...new Set([...args.leagueIds, ...claimedIds])]
  if (platformIds.length === 0 && leagueIds.length === 0) return buildFinalsIndex([], ownership)

  try {
    const rows = await prisma.$queryRaw<Array<{ leagueId: string; season: number; platformLeagueId: string; ps: unknown }>>`
      SELECT "leagueId", season, "platformLeagueId",
             jsonb_build_object(
               'bracketPlacementVersion', metadata->'playoffStructure'->'bracketPlacementVersion',
               'championRosterId', metadata->'playoffStructure'->'championRosterId',
               'runnerUpRosterId', metadata->'playoffStructure'->'runnerUpRosterId',
               -- The bracket only where the title game is not already stored (bracketPlacementVersion 2).
               'winnersBracket', CASE
                 WHEN metadata->'playoffStructure'->>'bracketPlacementVersion' = '2' THEN NULL
                 ELSE metadata->'playoffStructure'->'winnersBracket'
               END,
               -- The historical→current id map only where a CLAIMED team needs tracing back.
               'canonicalRosterIdByHistoricalRosterId', CASE
                 WHEN "leagueId" = ANY(${claimedIds}::text[])
                   THEN metadata->'playoffStructure'->'canonicalRosterIdByHistoricalRosterId'
                 ELSE NULL
               END
             ) AS ps
      FROM league_dynasty_seasons
      WHERE provider = 'sleeper'
        AND ("platformLeagueId" = ANY(${platformIds}::text[]) OR "leagueId" = ANY(${leagueIds}::text[]))
    `
    const titleRows: DynastyTitleRow[] = rows.map((r) => ({
      leagueId: r.leagueId,
      season: Number(r.season),
      platformLeagueId: r.platformLeagueId,
      playoffStructure: r.ps,
    }))
    return buildFinalsIndex(titleRows, ownership)
  } catch (err) {
    console.error('[core-app/career] stored playoff bracket read failed:', err)
    return buildFinalsIndex([], ownership)
  }
}

/** Identity plus every row — what a stored profile holds, minus the identity. */
export async function loadCareerSource(userId: string): Promise<CareerSource> {
  const identity = await loadCareerIdentity(userId)
  const { legacyUserId, ...rest } = identity
  const rows = await loadCareerRows(userId, legacyUserId)
  return { identity: rest, ...rows }
}

/**
 * The trophy room, read live.
 *
 * `filter` may be the old bare platform string (`?platform=`) or a whole
 * `CareerFilter`. The page reads through `careerProfile.ts` instead; this stays
 * for the share card, the dashboards and the kill switch.
 */
export async function getCareerData(
  userId: string,
  filter?: string | null | Partial<CareerFilter>,
): Promise<CareerData> {
  const resolved: CareerFilter =
    typeof filter === 'string' || filter == null
      ? { ...NO_CAREER_FILTER, platform: filter?.trim().toLowerCase() || null }
      : { ...NO_CAREER_FILTER, ...filter }
  return buildCareerData(await loadCareerSource(userId), resolved)
}
