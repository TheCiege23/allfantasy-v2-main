/**
 * Player Command Center (Slice 5) — per-league replacement options.
 *
 * For one affected player in one league: the best bench alternative on the
 * user's own roster and the best unrostered players at the same position,
 * each with a real projection delta vs the affected player. Real data only:
 *   - rosters:      Roster.playerData via the battle-tested lineup parser
 *   - projections:  FantasyProjection (latest available week for the league's
 *                   sport+season — the same table the war rooms read)
 *   - identity:     SportsPlayer (position/name for unrostered candidates,
 *                   keyed by sleeperId/externalId like the injury layer)
 * No projection rows → honest empty lists + reason, never invented numbers.
 */
import { prisma } from '@/lib/prisma'
import { getNormalizedLineupSections, type RosterSectionKey } from '@/lib/roster/LineupTemplateValidation'
import { resolveLinkedPlatformUserIds } from '../game-day/UserPlayerExposureService'

export interface ReplacementCandidate {
  playerId: string
  name: string
  position: string | null
  projectedPoints: number
  /** candidate projection − affected player's projection (positive = upgrade). Null when the affected player has no projection. */
  delta: number | null
}

/**
 * Slice 7 — where a free-agent chip can take the user to actually claim.
 *  - native:   AllFantasy's own waiver wire page (append &playerId=<candidate>).
 *  - provider: the provider's own league page (we can see imported leagues but
 *              never execute on them — honest scope, per the see-and-advise rule).
 *  - none:     no known claim surface for this league's platform.
 */
export type ClaimTarget =
  | { kind: 'native'; url: string }
  | { kind: 'provider'; provider: string; url: string }
  | { kind: 'none' }

export interface ReplacementOptionsResult {
  leagueId: string
  affectedPlayerId: string
  affectedProjection: number | null
  projectionWeek: number | null
  benchOptions: ReplacementCandidate[]
  freeAgentOptions: ReplacementCandidate[]
  claimTarget: ClaimTarget
  /** Slice 9 — where a bench chip can take the user to adjust their lineup. */
  lineupTarget: ClaimTarget
  /** Non-null when the lists are empty for a structural reason. */
  limitation: 'no_projection_data' | 'no_user_roster' | null
}

const NATIVE_PLATFORMS = new Set(['', 'allfantasy', 'af', 'manual', 'native'])

/** Exported for unit tests — deterministic platform → claim-target mapping. */
export function resolveClaimTarget(league: {
  id: string
  platform: string | null
  platformLeagueId: string | null
}): ClaimTarget {
  const platform = (league.platform ?? '').trim().toLowerCase()
  if (NATIVE_PLATFORMS.has(platform)) {
    return { kind: 'native', url: `/waiver-wire?leagueId=${encodeURIComponent(league.id)}` }
  }
  if (platform === 'sleeper' && league.platformLeagueId) {
    return {
      kind: 'provider',
      provider: 'sleeper',
      url: `https://sleeper.com/leagues/${encodeURIComponent(league.platformLeagueId)}/players`,
    }
  }
  return { kind: 'none' }
}

/**
 * Slice 9 — where a BENCH chip can take the user to actually change their
 * lineup. Native leagues → the league's own Team tab; Sleeper → the
 * provider's team page (see-and-advise). Same shape as ClaimTarget.
 */
export function resolveLineupTarget(league: {
  id: string
  platform: string | null
  platformLeagueId: string | null
}): ClaimTarget {
  const platform = (league.platform ?? '').trim().toLowerCase()
  if (NATIVE_PLATFORMS.has(platform)) {
    return { kind: 'native', url: `/leagues/${encodeURIComponent(league.id)}?tab=Team` }
  }
  if (platform === 'sleeper' && league.platformLeagueId) {
    return {
      kind: 'provider',
      provider: 'sleeper',
      url: `https://sleeper.com/leagues/${encodeURIComponent(league.platformLeagueId)}/team`,
    }
  }
  return { kind: 'none' }
}

/** Pure ranking helper (unit-tested): sort by projection desc, attach deltas, cap. */
export function rankReplacementCandidates(
  candidates: Array<{ playerId: string; name: string; position: string | null; projectedPoints: number }>,
  affectedProjection: number | null,
  limit: number,
): ReplacementCandidate[] {
  return [...candidates]
    .sort((a, b) => b.projectedPoints - a.projectedPoints)
    .slice(0, limit)
    .map((c) => ({
      ...c,
      delta: affectedProjection != null ? Number((c.projectedPoints - affectedProjection).toFixed(1)) : null,
    }))
}

const BENCH_SECTIONS: RosterSectionKey[] = ['bench', 'taxi']

export async function resolveReplacementOptions(args: {
  appUserId: string
  leagueId: string
  affectedPlayerId: string
}): Promise<ReplacementOptionsResult | null> {
  const { appUserId, leagueId, affectedPlayerId } = args

  const league = await prisma.league
    .findUnique({
      where: { id: leagueId },
      select: { id: true, sport: true, season: true, platform: true, platformLeagueId: true },
    })
    .catch(() => null)
  if (!league) return null

  const claimTarget = resolveClaimTarget(league)
  const lineupTarget = resolveLineupTarget(league)

  const [platformUserIds, rosters] = await Promise.all([
    resolveLinkedPlatformUserIds(appUserId),
    prisma.roster
      .findMany({ where: { leagueId }, select: { platformUserId: true, playerData: true } })
      .catch(() => [] as Array<{ platformUserId: string | null; playerData: unknown }>),
  ])

  const userRoster = rosters.find((r) => r.platformUserId && platformUserIds.includes(r.platformUserId))

  // Everyone's rostered ids (for the unrostered pool) + the user's bench rows.
  const rosteredIds = new Set<string>()
  let affectedPosition: string | null = null
  const benchRows: Array<{ id: string; name: string | null; position: string | null }> = []
  for (const roster of rosters) {
    const sections = getNormalizedLineupSections(roster.playerData)
    for (const [sectionKey, players] of Object.entries(sections) as Array<[RosterSectionKey, Array<Record<string, unknown>>]>) {
      for (const p of players) {
        const id = typeof p.id === 'string' ? p.id : ''
        if (!id) continue
        rosteredIds.add(id)
        if (id === affectedPlayerId && typeof p.position === 'string') affectedPosition = p.position
        if (roster === userRoster && BENCH_SECTIONS.includes(sectionKey)) {
          benchRows.push({
            id,
            name: typeof p.name === 'string' ? p.name : null,
            position: typeof p.position === 'string' ? p.position : null,
          })
        }
      }
    }
  }

  if (!userRoster) {
    return {
      leagueId,
      affectedPlayerId,
      affectedProjection: null,
      projectionWeek: null,
      benchOptions: [],
      freeAgentOptions: [],
      claimTarget,
      lineupTarget,
      limitation: 'no_user_roster',
    }
  }

  // Latest projection week available for this sport+season.
  const seasonStr = String(league.season)
  const latest = await prisma.fantasyProjection
    .findFirst({
      where: { sport: league.sport, season: seasonStr },
      orderBy: [{ week: 'desc' }, { fetchedAt: 'desc' }],
      select: { week: true },
    })
    .catch(() => null)

  if (!latest) {
    return {
      leagueId,
      affectedPlayerId,
      affectedProjection: null,
      projectionWeek: null,
      benchOptions: [],
      freeAgentOptions: [],
      claimTarget,
      lineupTarget,
      limitation: 'no_projection_data',
    }
  }

  const week = latest.week

  // One projection query covers the affected player + the user's bench; a
  // second finds the top unrostered projections for the same week.
  const benchIds = benchRows.map((r) => r.id)
  const [ownProjections, poolProjections] = await Promise.all([
    prisma.fantasyProjection
      .findMany({
        where: { sport: league.sport, season: seasonStr, week, playerId: { in: [affectedPlayerId, ...benchIds] } },
        select: { playerId: true, projectedPoints: true },
      })
      .catch(() => [] as Array<{ playerId: string; projectedPoints: number }>),
    prisma.fantasyProjection
      .findMany({
        where: { sport: league.sport, season: seasonStr, week, playerId: { notIn: Array.from(rosteredIds) } },
        orderBy: { projectedPoints: 'desc' },
        take: 60,
        select: { playerId: true, projectedPoints: true },
      })
      .catch(() => [] as Array<{ playerId: string; projectedPoints: number }>),
  ])

  const projById = new Map(ownProjections.map((p) => [p.playerId, p.projectedPoints]))
  const affectedProjection = projById.get(affectedPlayerId) ?? null

  // Bench candidates at the same position (when known; otherwise all bench).
  const benchCandidates = benchRows
    .filter((r) => projById.has(r.id) && r.id !== affectedPlayerId)
    .filter((r) => !affectedPosition || !r.position || r.position === affectedPosition)
    .map((r) => ({ playerId: r.id, name: r.name ?? 'Unknown', position: r.position, projectedPoints: projById.get(r.id)! }))

  // Unrostered candidates: resolve identity (name/position) via SportsPlayer,
  // then filter to the affected position when known.
  const poolIds = poolProjections.map((p) => p.playerId)
  const identityRows = poolIds.length
    ? await prisma.sportsPlayer
        .findMany({
          where: { sport: league.sport, OR: [{ sleeperId: { in: poolIds } }, { externalId: { in: poolIds } }] },
          select: { sleeperId: true, externalId: true, name: true, position: true },
        })
        .catch(() => [] as Array<{ sleeperId: string | null; externalId: string | null; name: string; position: string | null }>)
    : []
  const identityById = new Map<string, { name: string; position: string | null }>()
  for (const row of identityRows) {
    if (row.sleeperId) identityById.set(row.sleeperId, { name: row.name, position: row.position })
    if (row.externalId) identityById.set(row.externalId, { name: row.name, position: row.position })
  }
  const freeAgentCandidates = poolProjections
    .map((p) => {
      const identity = identityById.get(p.playerId)
      return identity
        ? { playerId: p.playerId, name: identity.name, position: identity.position, projectedPoints: p.projectedPoints }
        : null
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .filter((c) => !affectedPosition || !c.position || c.position === affectedPosition)

  return {
    leagueId,
    affectedPlayerId,
    affectedProjection,
    projectionWeek: week,
    benchOptions: rankReplacementCandidates(benchCandidates, affectedProjection, 3),
    freeAgentOptions: rankReplacementCandidates(freeAgentCandidates, affectedProjection, 3),
    claimTarget,
    lineupTarget,
    limitation: null,
  }
}
