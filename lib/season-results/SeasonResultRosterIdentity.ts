interface SeasonResultRosterLookupRow {
  id: string
  leagueId: string
  playerData?: unknown
}

export interface SeasonResultManagerLookupRow extends SeasonResultRosterLookupRow {
  platformUserId?: string | null
}

interface ResolvedSeasonResultRosterIds {
  leagueIds: string[]
  rosterIds: string[]
  rosterIdsByLeague: Map<string, string[]>
}

interface LeagueScopedRosterIdFilter {
  leagueId: string
  rosterId: { in: string[] }
}

interface BasicSeasonResultAliasRow {
  leagueId: string
  season: string
  wins?: number | null
  losses?: number | null
  champion?: boolean | null
  madePlayoffs?: boolean | null
  playoffSeed?: number | null
  playoffFinish?: string | null
  playoffWins?: number | null
  playoffLosses?: number | null
  bestFinish?: number | null
}

function toPositiveFiniteNumber(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
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

function extractSourceTeamId(playerData: unknown): string | null {
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) {
    return null
  }

  const rawSourceTeamId = (playerData as Record<string, unknown>).source_team_id
  if (typeof rawSourceTeamId === 'string' && rawSourceTeamId.trim()) {
    return rawSourceTeamId.trim()
  }

  if (typeof rawSourceTeamId === 'number' && Number.isFinite(rawSourceTeamId)) {
    return String(rawSourceTeamId)
  }

  return null
}

export function getSeasonResultKeysForRoster(
  roster: SeasonResultRosterLookupRow
): string[] {
  const keys = [roster.id]
  const sourceTeamId = extractSourceTeamId(roster.playerData)

  if (sourceTeamId && sourceTeamId !== roster.id) {
    keys.push(sourceTeamId)
  }

  return keys
}

export function buildSeasonResultManagerMap(
  rosters: SeasonResultManagerLookupRow[]
): Map<string, string> {
  const rosterIdToManager = new Map<string, string>()

  for (const roster of rosters) {
    if (!roster.platformUserId) {
      continue
    }

    rosterIdToManager.set(roster.platformUserId, roster.platformUserId)
    for (const key of getSeasonResultKeysForRoster(roster)) {
      rosterIdToManager.set(key, roster.platformUserId)
    }
  }

  return rosterIdToManager
}

export function buildLeagueScopedRosterIdFilters(
  resolved: ResolvedSeasonResultRosterIds
): LeagueScopedRosterIdFilter[] {
  const filters: LeagueScopedRosterIdFilter[] = []

  for (const [leagueId, rosterIds] of resolved.rosterIdsByLeague.entries()) {
    if (rosterIds.length === 0) {
      continue
    }

    filters.push({
      leagueId,
      rosterId: { in: rosterIds },
    })
  }

  return filters
}

export function mergeSeasonResultAliases<T extends BasicSeasonResultAliasRow>(
  rows: T[]
): Array<{
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
}> {
  const bySeason = new Map<
    string,
    {
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
  >()

  for (const row of rows) {
    const key = `${row.leagueId}:${row.season}`
    const existing = bySeason.get(key)
    const wins = row.wins ?? 0
    const losses = row.losses ?? 0
    const champion = row.champion ?? false
    const playoffSeed = toPositiveFiniteNumber(row.playoffSeed)
    const bestFinish = toPositiveFiniteNumber(row.bestFinish)
    const playoffWins = Math.max(0, row.playoffWins ?? 0)
    const playoffLosses = Math.max(0, row.playoffLosses ?? 0)
    const madePlayoffs = !!row.madePlayoffs || champion || playoffSeed != null || bestFinish != null
    const playoffFinish = derivePlayoffFinishLabel({
      champion,
      playoffFinish: row.playoffFinish,
      bestFinish,
      madePlayoffs,
    })

    if (!existing) {
      bySeason.set(key, {
        leagueId: row.leagueId,
        season: row.season,
        wins,
        losses,
        champion,
        madePlayoffs,
        playoffSeed,
        playoffFinish,
        playoffWins,
        playoffLosses,
        bestFinish,
      })
      continue
    }

    existing.wins = Math.max(existing.wins, wins)
    existing.losses = Math.max(existing.losses, losses)
    existing.champion = existing.champion || champion
    existing.madePlayoffs = existing.madePlayoffs || madePlayoffs || existing.champion
    existing.playoffWins = Math.max(existing.playoffWins, playoffWins)
    existing.playoffLosses = Math.max(existing.playoffLosses, playoffLosses)
    existing.playoffSeed =
      existing.playoffSeed == null
        ? playoffSeed
        : playoffSeed == null
          ? existing.playoffSeed
          : Math.min(existing.playoffSeed, playoffSeed)
    existing.bestFinish =
      existing.bestFinish == null
        ? bestFinish
        : bestFinish == null
          ? existing.bestFinish
          : Math.min(existing.bestFinish, bestFinish)
    existing.playoffFinish = derivePlayoffFinishLabel({
      champion: existing.champion,
      playoffFinish: existing.playoffFinish ?? playoffFinish,
      bestFinish: existing.bestFinish,
      madePlayoffs: existing.madePlayoffs,
    })
  }

  return Array.from(bySeason.values())
}

/**
 * SeasonResult rows may be keyed by either the app's internal Roster.id or the
 * imported provider roster identifier stored in playerData.source_team_id.
 */
export function resolveSeasonResultRosterIds(
  rosters: SeasonResultRosterLookupRow[]
): ResolvedSeasonResultRosterIds {
  const rosterIdsByLeagueSet = new Map<string, Set<string>>()
  const rosterIdSet = new Set<string>()

  for (const roster of rosters) {
    const idsForLeague = rosterIdsByLeagueSet.get(roster.leagueId) ?? new Set<string>()
    for (const rosterId of getSeasonResultKeysForRoster(roster)) {
      idsForLeague.add(rosterId)
      rosterIdSet.add(rosterId)
    }

    rosterIdsByLeagueSet.set(roster.leagueId, idsForLeague)
  }

  const rosterIdsByLeague = new Map<string, string[]>(
    Array.from(rosterIdsByLeagueSet.entries()).map(([leagueId, ids]) => [
      leagueId,
      Array.from(ids),
    ])
  )

  return {
    leagueIds: Array.from(rosterIdsByLeague.keys()),
    rosterIds: Array.from(rosterIdSet),
    rosterIdsByLeague,
  }
}
