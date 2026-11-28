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
import { indexBySleeperId, sleeperIdWhere } from '@/lib/player-identity/externalIdNamespace'
import { getNormalizedLineupSections, type RosterSectionKey } from '@/lib/roster/LineupTemplateValidation'
import { resolveLinkedPlatformUserIds } from '../game-day/UserPlayerExposureService'
import { collectRosterIds, isForeignIdSpace, stripForeignIds } from '@/lib/core-app/rosterIdSpace'
import { declaredAvailability } from '@/lib/core-app/declaredAvailability'
import { declaredBenchOf, declaredSleeperId, toDeclaredSleeperId } from '@/lib/core-app/declaredSleeperId'

export interface ReplacementCandidate {
  playerId: string
  name: string
  position: string | null
  /**
   * His club, from the player table, so a caller can read his own kickoff — a
   * free agent whose game has started cannot come into a lineup now
   * (lib/core-app/playerMoves.ts). Null when the identity row has none.
   */
  team: string | null
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
  /**
   * Non-null when the lists are empty for a structural reason. `availability_unverified`: a pasted
   * Yahoo league below the coverage bar (declaredAvailability.ts) — nobody can be called available.
   */
  limitation: 'no_projection_data' | 'no_user_roster' | 'roster_ids_unreadable' | 'availability_unverified' | null
  /**
   * A pasted Yahoo league only: rostered players no Sleeper-id read can see. With `limitation: null`
   * the free-agent list stands, each one's own row hidden by name; absent for every other league.
   */
  unmatchedRostered?: number
  /**
   * A pasted Yahoo league only. `starters_not_recorded`: the user's roster records no starter, so its
   * bench cannot be told apart from its starters and `benchOptions` is empty on purpose.
   */
  benchLimitation?: 'starters_not_recorded'
  /** A pasted Yahoo league only: bench players no Sleeper-id read can see — counted, never listed. */
  benchUnmatched?: number
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
  candidates: Array<{ playerId: string; name: string; position: string | null; team?: string | null; projectedPoints: number }>,
  affectedProjection: number | null,
  limit: number,
): ReplacementCandidate[] {
  return [...candidates]
    .sort((a, b) => b.projectedPoints - a.projectedPoints)
    .slice(0, limit)
    .map((c) => ({
      ...c,
      team: c.team ?? null,
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

  /*
   * A foreign league's roster ids (Fleaflicker, MFL, ...) collide with real Sleeper ids, and the
   * projection table is keyed on Sleeper ids: a bench id would carry a stranger's projection, and
   * nobody could be subtracted from the "unrostered" pool. Honest empty lists, with the reason.
   */
  const [platformUserIds, rawRosters] = await Promise.all([
    resolveLinkedPlatformUserIds(appUserId),
    prisma.roster
      .findMany({ where: { leagueId }, select: { platformUserId: true, playerData: true } })
      .catch(() => [] as Array<{ platformUserId: string | null; playerData: unknown }>),
  ])
  /*
   * ⚠ EXCEPT A PASTED YAHOO LEAGUE: its matched players carry declared Sleeper ids. Above the coverage
   * bar it is read through them (`stripForeignIds` keeps exactly those), its unmatched rostered players
   * hidden from the free agents by name and counted; below it, no list at all.
   */
  const foreign = isForeignIdSpace(league.platform, league.sport)
  const declared = foreign ? declaredAvailability(league.platform, rawRosters.map((r) => r.playerData)) : null
  if (declared && !declared.verified) {
    return {
      leagueId,
      affectedPlayerId,
      affectedProjection: null,
      projectionWeek: null,
      benchOptions: [],
      freeAgentOptions: [],
      claimTarget,
      lineupTarget,
      limitation: 'availability_unverified',
      unmatchedRostered: declared.unmatched,
    }
  }
  // A native league of another sport too: its Rolling Insights ids are not Sleeper ids (rosterIdSpace.ts).
  if (foreign && !declared) {
    return {
      leagueId,
      affectedPlayerId,
      affectedProjection: null,
      projectionWeek: null,
      benchOptions: [],
      freeAgentOptions: [],
      claimTarget,
      lineupTarget,
      limitation: 'roster_ids_unreadable',
    }
  }

  const rosters = declared ? rawRosters.map((r) => ({ ...r, playerData: stripForeignIds(r.playerData) })) : rawRosters

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
        // A pasted league's bench is read from its plain roster list below, not from id-only sections.
        if (!declared && roster === userRoster && BENCH_SECTIONS.includes(sectionKey)) {
          benchRows.push({
            id,
            name: typeof p.name === 'string' ? p.name : null,
            position: typeof p.position === 'string' ? p.position : null,
          })
        }
      }
    }
  }

  /*
   * A pasted Yahoo roster keeps its players in the plain arrays (`players`/`starters`/…), not in
   * `lineup_sections`, so they are read there too — a rostered player missed here is offered as a free
   * agent. Only ever adds to the rostered set.
   */
  if (declared) for (const id of collectRosterIds(rosters.map((r) => r.playerData))) rosteredIds.add(id)

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

  /*
   * A PASTED Yahoo roster: the bench is its plain list minus the recorded starters and IR
   * (declaredSleeperId.ts `declaredBenchOf`), named and positioned from the `player_metadata` the import
   * stored under each roster id. Its `lineup_sections` entries are bare ids, which read as position
   * "UTIL" — so the affected player's position comes from that metadata too, or is left unknown.
   */
  let benchLimitation: ReplacementOptionsResult['benchLimitation']
  let benchUnmatched: number | undefined
  if (declared) {
    const raw = rawRosters.find((r) => r.platformUserId === userRoster.platformUserId)?.playerData
    const meta = metadataOf(raw)
    const affectedMeta = meta.get(toDeclaredSleeperId(declaredSleeperId(affectedPlayerId) ?? affectedPlayerId))
    affectedPosition = affectedMeta?.position ?? (affectedPosition === 'UTIL' ? null : affectedPosition)
    const bench = declaredBenchOf(raw)
    if (!bench.recorded) {
      benchLimitation = 'starters_not_recorded'
    } else {
      benchUnmatched = bench.unmatched
      for (const { rosterId, sleeperId } of bench.priced) {
        const m = meta.get(rosterId)
        benchRows.push({ id: sleeperId, name: m?.name ?? null, position: m?.position ?? null })
      }
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
  /*
   * 🛑 Projection ids are Sleeper ids, so by Sleeper id only — never against `externalId`, where
   * Rolling Insights keeps its own numbers for different people (Sleeper 9228 is Bryce Young; RI
   * 9228 is an offensive tackle). Here the impostor did double damage: its name was offered as the
   * replacement, and its POSITION decided whether a real candidate survived the same-position filter
   * below. 422 of the top 900 week-4 projections had such an impostor (2026-09-29).
   */
  const poolIds = poolProjections.map((p) => p.playerId)
  const identityRows = poolIds.length
    ? await prisma.sportsPlayer
        .findMany({
          where: sleeperIdWhere(poolIds, league.sport),
          select: { sleeperId: true, source: true, name: true, position: true, team: true },
        })
        .catch(() => [] as Array<{ sleeperId: string | null; source: string; name: string; position: string | null; team: string | null }>)
    : []
  const identityById = new Map<string, { name: string; position: string | null; team: string | null }>()
  for (const [sleeperId, row] of indexBySleeperId(identityRows)) {
    identityById.set(sleeperId, { name: row.name, position: row.position, team: row.team })
  }
  const freeAgentCandidates = poolProjections
    .map((p) => {
      const identity = identityById.get(p.playerId)
      return identity
        ? { playerId: p.playerId, name: identity.name, position: identity.position, team: identity.team, projectedPoints: p.projectedPoints }
        : null
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    // A pasted Yahoo league's unmatched rostered player is somebody's, not a free agent.
    .filter((c) => !declared?.hides({ name: c.name, position: c.position, team: c.team }))
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
    ...(declared ? { unmatchedRostered: declared.unmatched } : {}),
    ...(benchLimitation ? { benchLimitation } : {}),
    ...(benchUnmatched !== undefined ? { benchUnmatched } : {}),
  }
}

/** A roster's `player_metadata` (written by the import for every id): stored id → name and position. */
function metadataOf(playerData: unknown): Map<string, { name: string | null; position: string | null }> {
  const out = new Map<string, { name: string | null; position: string | null }>()
  const meta = playerData && typeof playerData === 'object' ? (playerData as Record<string, unknown>).player_metadata : null
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return out
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  for (const [id, row] of Object.entries(meta as Record<string, unknown>)) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    out.set(id, { name: text(r.name), position: text(r.position)?.toUpperCase() ?? null })
  }
  return out
}
