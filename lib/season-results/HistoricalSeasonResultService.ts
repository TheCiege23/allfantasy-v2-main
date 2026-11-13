import { prisma } from '@/lib/prisma'
import {
  buildLeagueScopedRosterIdFilters,
  buildSeasonResultManagerMap,
  getSeasonResultKeysForRoster,
  mergeSeasonResultAliases,
  resolveSeasonResultRosterIds,
  type SeasonResultManagerLookupRow,
} from './SeasonResultRosterIdentity'

interface EnrichedSeasonResultRow {
  leagueId: string
  season: string
  wins: number
  losses: number
  champion: boolean
  madePlayoffs: boolean
  playoffSeed: number | null
  playoffFinish: string | null
  playoffWins: number
  playoffLosses: number
  bestFinish: number | null
}

interface EnrichedLeagueSeasonResultRow extends EnrichedSeasonResultRow {
  rosterId: string
  managerId: string
  pointsFor: number
  pointsAgainst: number
}

interface RawSeasonResultRow {
  leagueId: string
  season: string
  rosterId: string
  wins: number | null
  losses: number | null
  champion: boolean
}

interface RawLeagueSeasonResultRow extends RawSeasonResultRow {
  pointsFor: number | null
  pointsAgainst: number | null
}

interface ParsedPlayoffRow {
  madePlayoffs: boolean
  playoffSeed: number | null
  playoffFinish: string | null
  playoffWins: number
  playoffLosses: number
  bestFinish: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function toPositiveFiniteNumber(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

function toNonNegativeFiniteNumber(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0
  }

  return parsed
}

function parsePlayoffRow(value: unknown): ParsedPlayoffRow | null {
  if (!isRecord(value)) {
    return null
  }

  const playoffSeed = toPositiveFiniteNumber(value.playoffSeed)
  const bestFinish = toPositiveFiniteNumber(value.bestFinish)
  const playoffFinish =
    typeof value.label === 'string' && value.label.trim()
      ? value.label.trim()
      : typeof value.playoffFinish === 'string' && value.playoffFinish.trim()
        ? value.playoffFinish.trim()
        : null

  const madePlayoffs =
    value.madePlayoffs === true ||
    value.isChampion === true ||
    value.isRunnerUp === true ||
    playoffSeed != null ||
    bestFinish != null ||
    playoffFinish != null

  return {
    madePlayoffs,
    playoffSeed,
    playoffFinish,
    playoffWins: toNonNegativeFiniteNumber(value.playoffWins),
    playoffLosses: toNonNegativeFiniteNumber(value.playoffLosses),
    bestFinish,
  }
}

function derivePlayoffFinishLabel(args: {
  champion: boolean
  playoffFinish?: string | null
  bestFinish?: number | null
  madePlayoffs: boolean
}): string | null {
  if (args.champion) {
    return 'Champion'
  }

  if (typeof args.playoffFinish === 'string' && args.playoffFinish.trim()) {
    return args.playoffFinish.trim()
  }

  if (args.bestFinish === 2) {
    return 'Runner-up'
  }

  if (args.bestFinish != null && args.bestFinish > 0 && args.bestFinish <= 4) {
    return 'Semifinalist'
  }

  if (args.madePlayoffs) {
    return 'Playoff Team'
  }

  return null
}

function buildPlayoffLookup(metadata: unknown): {
  byRosterId: Map<string, ParsedPlayoffRow>
  byCanonicalRosterId: Map<string, ParsedPlayoffRow>
} {
  const byRosterId = new Map<string, ParsedPlayoffRow>()
  const byCanonicalRosterId = new Map<string, ParsedPlayoffRow>()

  if (!isRecord(metadata)) {
    return { byRosterId, byCanonicalRosterId }
  }

  const playoffStructure = isRecord(metadata.playoffStructure)
    ? metadata.playoffStructure
    : null
  const finishByRosterId = playoffStructure && isRecord(playoffStructure.playoffFinishByRosterId)
    ? playoffStructure.playoffFinishByRosterId
    : null

  if (!finishByRosterId) {
    return { byRosterId, byCanonicalRosterId }
  }

  for (const [rosterId, rawValue] of Object.entries(finishByRosterId)) {
    const parsed = parsePlayoffRow(rawValue)
    if (!parsed) {
      continue
    }

    byRosterId.set(rosterId, parsed)

    if (isRecord(rawValue)) {
      const canonicalRosterId = rawValue.canonicalRosterId
      if (typeof canonicalRosterId === 'string' && canonicalRosterId.trim()) {
        byCanonicalRosterId.set(canonicalRosterId.trim(), parsed)
      }
    }
  }

  return { byRosterId, byCanonicalRosterId }
}

function buildAliasKeysByManager(
  rosters: SeasonResultManagerLookupRow[]
): Map<string, Set<string>> {
  const aliasKeysByManager = new Map<string, Set<string>>()

  for (const roster of rosters) {
    if (!roster.platformUserId) {
      continue
    }

    const aliasKeys = aliasKeysByManager.get(roster.platformUserId) ?? new Set<string>()
    aliasKeys.add(roster.platformUserId)
    for (const key of getSeasonResultKeysForRoster(roster)) {
      aliasKeys.add(key)
    }
    aliasKeysByManager.set(roster.platformUserId, aliasKeys)
  }

  return aliasKeysByManager
}

function resolvePlayoffInfoForRow(args: {
  row: RawSeasonResultRow
  lookup: { byRosterId: Map<string, ParsedPlayoffRow>; byCanonicalRosterId: Map<string, ParsedPlayoffRow> }
  managerIdBySeasonResultKey: Map<string, string>
  aliasKeysByManager: Map<string, Set<string>>
}): ParsedPlayoffRow | null {
  const direct =
    args.lookup.byRosterId.get(args.row.rosterId) ??
    args.lookup.byCanonicalRosterId.get(args.row.rosterId)

  if (direct) {
    return direct
  }

  const managerId = args.managerIdBySeasonResultKey.get(args.row.rosterId)
  if (!managerId) {
    return null
  }

  const aliasKeys = args.aliasKeysByManager.get(managerId)
  if (!aliasKeys) {
    return null
  }

  for (const aliasKey of aliasKeys) {
    const aliasMatch =
      args.lookup.byRosterId.get(aliasKey) ??
      args.lookup.byCanonicalRosterId.get(aliasKey)
    if (aliasMatch) {
      return aliasMatch
    }
  }

  return null
}

export async function getMergedHistoricalSeasonResultsForManager(args: {
  managerId: string
  rosters?: SeasonResultManagerLookupRow[]
}): Promise<EnrichedSeasonResultRow[]> {
  const rosters =
    args.rosters ??
    (await prisma.roster.findMany({
      where: { platformUserId: args.managerId },
      select: { id: true, leagueId: true, platformUserId: true, playerData: true },
    }))

  const seasonResultRosterIds = resolveSeasonResultRosterIds(rosters)
  const seasonResultFilters = buildLeagueScopedRosterIdFilters(seasonResultRosterIds)

  const [seasonResultsByManagerId, seasonResultsByRoster] = await Promise.all([
    prisma.seasonResult.findMany({
      where: { rosterId: args.managerId },
      select: {
        leagueId: true,
        season: true,
        rosterId: true,
        wins: true,
        losses: true,
        champion: true,
      },
    }),
    seasonResultFilters.length > 0
      ? prisma.seasonResult.findMany({
          where: {
            OR: seasonResultFilters,
          },
          select: {
            leagueId: true,
            season: true,
            rosterId: true,
            wins: true,
            losses: true,
            champion: true,
          },
        })
      : Promise.resolve([]),
  ])

  const rawRows: RawSeasonResultRow[] = [...seasonResultsByManagerId, ...seasonResultsByRoster].map(
    (row) => ({
      leagueId: row.leagueId,
      season: row.season,
      rosterId: row.rosterId,
      wins: row.wins ?? null,
      losses: row.losses ?? null,
      champion: row.champion ?? false,
    })
  )

  if (rawRows.length === 0) {
    return []
  }

  const pairKeys = new Set<string>()
  const seasonPairs: Array<{ leagueId: string; season: number }> = []
  for (const row of rawRows) {
    const seasonNumber = Number.parseInt(row.season, 10)
    if (!Number.isFinite(seasonNumber)) {
      continue
    }

    const key = `${row.leagueId}:${seasonNumber}`
    if (pairKeys.has(key)) {
      continue
    }

    pairKeys.add(key)
    seasonPairs.push({ leagueId: row.leagueId, season: seasonNumber })
  }

  const dynastySeasons =
    seasonPairs.length > 0
      ? await prisma.leagueDynastySeason.findMany({
          where: {
            OR: seasonPairs,
          },
          select: {
            leagueId: true,
            season: true,
            metadata: true,
          },
        })
      : []

  const playoffLookupBySeason = new Map<
    string,
    { byRosterId: Map<string, ParsedPlayoffRow>; byCanonicalRosterId: Map<string, ParsedPlayoffRow> }
  >()
  for (const dynastySeason of dynastySeasons) {
    playoffLookupBySeason.set(
      `${dynastySeason.leagueId}:${dynastySeason.season}`,
      buildPlayoffLookup(dynastySeason.metadata)
    )
  }

  const managerIdBySeasonResultKey = buildSeasonResultManagerMap(rosters)
  const aliasKeysByManager = buildAliasKeysByManager(rosters)

  return mergeSeasonResultAliases(
    rawRows.map((row) => {
      const playoffInfo = resolvePlayoffInfoForRow({
        row,
        lookup:
          playoffLookupBySeason.get(`${row.leagueId}:${Number.parseInt(row.season, 10)}`) ?? {
            byRosterId: new Map(),
            byCanonicalRosterId: new Map(),
          },
        managerIdBySeasonResultKey,
        aliasKeysByManager,
      })

      return {
        leagueId: row.leagueId,
        season: row.season,
        wins: row.wins,
        losses: row.losses,
        champion: row.champion,
        madePlayoffs: playoffInfo?.madePlayoffs ?? row.champion,
        playoffSeed: playoffInfo?.playoffSeed ?? null,
        playoffFinish: playoffInfo?.playoffFinish ?? (row.champion ? 'Champion' : null),
        playoffWins: playoffInfo?.playoffWins ?? 0,
        playoffLosses: playoffInfo?.playoffLosses ?? 0,
        bestFinish: playoffInfo?.bestFinish ?? (row.champion ? 1 : null),
      }
    })
  )
}

export async function getMergedHistoricalSeasonResultsForLeague(args: {
  leagueId: string
  season?: string | null
}): Promise<EnrichedLeagueSeasonResultRow[]> {
  const [rosters, seasonResults] = await Promise.all([
    prisma.roster.findMany({
      where: { leagueId: args.leagueId },
      select: { id: true, leagueId: true, platformUserId: true, playerData: true },
    }),
    prisma.seasonResult.findMany({
      where: {
        leagueId: args.leagueId,
        ...(args.season ? { season: args.season } : {}),
      },
      select: {
        leagueId: true,
        season: true,
        rosterId: true,
        wins: true,
        losses: true,
        pointsFor: true,
        pointsAgainst: true,
        champion: true,
      },
      orderBy: [{ season: 'desc' }],
    }),
  ])

  if (seasonResults.length === 0) {
    return []
  }

  type SeasonEntry = readonly [`${string}:${number}`, { readonly leagueId: string; readonly season: number }]
  const entries: SeasonEntry[] = seasonResults
    .map((row) => {
      const seasonNumber = Number.parseInt(row.season, 10)
      if (!Number.isFinite(seasonNumber)) {
        return null
      }
      return [`${row.leagueId}:${seasonNumber}`, { leagueId: row.leagueId, season: seasonNumber }] as const
    })
    .filter((value): value is SeasonEntry => value !== null)
  const seasonPairs = Array.from(new Map(entries).values())

  const dynastySeasons =
    seasonPairs.length > 0
      ? await prisma.leagueDynastySeason.findMany({
          where: {
            OR: seasonPairs,
          },
          select: {
            leagueId: true,
            season: true,
            metadata: true,
          },
        })
      : []

  const playoffLookupBySeason = new Map<
    string,
    { byRosterId: Map<string, ParsedPlayoffRow>; byCanonicalRosterId: Map<string, ParsedPlayoffRow> }
  >()
  for (const dynastySeason of dynastySeasons) {
    playoffLookupBySeason.set(
      `${dynastySeason.leagueId}:${dynastySeason.season}`,
      buildPlayoffLookup(dynastySeason.metadata)
    )
  }

  const managerIdBySeasonResultKey = buildSeasonResultManagerMap(rosters)
  const aliasKeysByManager = buildAliasKeysByManager(rosters)
  const byManagerSeason = new Map<string, EnrichedLeagueSeasonResultRow>()

  for (const row of seasonResults as RawLeagueSeasonResultRow[]) {
    const managerId = managerIdBySeasonResultKey.get(row.rosterId) ?? row.rosterId
    const playoffInfo = resolvePlayoffInfoForRow({
      row,
      lookup:
        playoffLookupBySeason.get(`${row.leagueId}:${Number.parseInt(row.season, 10)}`) ?? {
          byRosterId: new Map(),
          byCanonicalRosterId: new Map(),
        },
      managerIdBySeasonResultKey,
      aliasKeysByManager,
    })

    const madePlayoffs = playoffInfo?.madePlayoffs ?? row.champion
    const bestFinish = playoffInfo?.bestFinish ?? (row.champion ? 1 : null)
    const playoffFinish = derivePlayoffFinishLabel({
      champion: row.champion,
      playoffFinish: playoffInfo?.playoffFinish ?? null,
      bestFinish,
      madePlayoffs,
    })

    const key = `${managerId}:${row.season}`
    const existing = byManagerSeason.get(key)
    const nextRow: EnrichedLeagueSeasonResultRow = {
      leagueId: row.leagueId,
      season: row.season,
      rosterId: managerId,
      managerId,
      wins: row.wins ?? 0,
      losses: row.losses ?? 0,
      pointsFor: Number(row.pointsFor ?? 0),
      pointsAgainst: Number(row.pointsAgainst ?? 0),
      champion: row.champion ?? false,
      madePlayoffs,
      playoffSeed: playoffInfo?.playoffSeed ?? null,
      playoffFinish,
      playoffWins: playoffInfo?.playoffWins ?? 0,
      playoffLosses: playoffInfo?.playoffLosses ?? 0,
      bestFinish,
    }

    if (!existing) {
      byManagerSeason.set(key, nextRow)
      continue
    }

    existing.wins = Math.max(existing.wins, nextRow.wins)
    existing.losses = Math.max(existing.losses, nextRow.losses)
    existing.pointsFor = Math.max(existing.pointsFor, nextRow.pointsFor)
    existing.pointsAgainst = Math.max(existing.pointsAgainst, nextRow.pointsAgainst)
    existing.champion = existing.champion || nextRow.champion
    existing.madePlayoffs = existing.madePlayoffs || nextRow.madePlayoffs || existing.champion
    existing.playoffWins = Math.max(existing.playoffWins, nextRow.playoffWins)
    existing.playoffLosses = Math.max(existing.playoffLosses, nextRow.playoffLosses)
    existing.playoffSeed =
      existing.playoffSeed == null
        ? nextRow.playoffSeed
        : nextRow.playoffSeed == null
          ? existing.playoffSeed
          : Math.min(existing.playoffSeed, nextRow.playoffSeed)
    existing.bestFinish =
      existing.bestFinish == null
        ? nextRow.bestFinish
        : nextRow.bestFinish == null
          ? existing.bestFinish
          : Math.min(existing.bestFinish, nextRow.bestFinish)
    existing.playoffFinish = derivePlayoffFinishLabel({
      champion: existing.champion,
      playoffFinish: existing.playoffFinish ?? nextRow.playoffFinish,
      bestFinish: existing.bestFinish,
      madePlayoffs: existing.madePlayoffs,
    })
  }

  return Array.from(byManagerSeason.values()).sort((left, right) => {
    const seasonDelta = Number.parseInt(right.season, 10) - Number.parseInt(left.season, 10)
    if (seasonDelta !== 0) {
      return seasonDelta
    }

    if (left.champion !== right.champion) {
      return left.champion ? -1 : 1
    }

    if (left.madePlayoffs !== right.madePlayoffs) {
      return left.madePlayoffs ? -1 : 1
    }

    if ((left.bestFinish ?? 999) !== (right.bestFinish ?? 999)) {
      return (left.bestFinish ?? 999) - (right.bestFinish ?? 999)
    }

    if (left.wins !== right.wins) {
      return right.wins - left.wins
    }

    return right.pointsFor - left.pointsFor
  })
}
