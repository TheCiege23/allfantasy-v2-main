import type { ADPEntry } from '@/lib/adp-data'
import type { DraftPlayer } from '@/lib/mock-draft-simulator/types'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { getPlayerPoolForLeague, getPlayerPoolForSport } from '@/lib/sport-teams/SportPlayerPoolResolver'
import type { LeagueSport } from '@prisma/client'
import type { PoolPlayerRecord } from '@/lib/sport-teams/types'
import { canonicalName } from '@/lib/draft-room/player-canonical-identity'
import { loadNbaSurvivorRosterEligibility, nbaSurvivorPlayerIdMatches, type NbaRosterEligibility } from '@/lib/draft-room/nbaSurvivorRosterEligibility'
import { loadLatestAveragedAdpRowsFromDb } from '@/lib/draft-room/getResolvedDraftPoolForLeague'

export type SportAwareDraftPlayer = DraftPlayer & {
  sport: LeagueSport
  source: 'sports-player-pool'
  age?: number | null
}


/** Pure selection used by the server loader and read-only production-data audits. */
export function selectVerifiedNbaMockPlayers(
  rows: readonly Pick<PoolPlayerRecord, 'full_name' | 'external_source_id' | 'position' | 'team_abbreviation' | 'age'>[],
  eligibility: NbaRosterEligibility,
  market: readonly { name: string; adp: number }[],
  limit: number,
): SportAwareDraftPlayer[] {
  const sport = 'NBA' as const
  if (!eligibility.ready) throw new Error(eligibility.reason ?? 'Current NBA roster unavailable')
  const adpByName = new Map<string, number>()
  for (const entry of market) {
    const key = canonicalName(entry.name)
    const previous = adpByName.get(key)
    if (previous == null || entry.adp < previous) adpByName.set(key, entry.adp)
  }
  const basketballPositions = new Set(['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'GF', 'FC'])
  const byName = new Map<string, SportAwareDraftPlayer>()
  for (const player of rows) {
    const id = player.external_source_id ?? ''
    const position = player.position.trim().toUpperCase()
    // Daily NBA scoring needs a verified numeric RI identity; vendor staff and historical
    // profiles must not consume the display limit before current athletes are considered.
    if (!basketballPositions.has(position) || !/^\d+$/.test(id) ||
        !nbaSurvivorPlayerIdMatches(eligibility, player.full_name, id)) continue
    const key = canonicalName(player.full_name)
    if (byName.has(key)) continue
    byName.set(key, {
      name: player.full_name, position, team: player.team_abbreviation ?? null,
      playerId: id, sport, source: 'sports-player-pool', age: player.age ?? null,
      adp: adpByName.get(key) ?? null, value: null,
    })
  }
  return [...byName.values()].sort((a, b) =>
    (a.adp ?? Infinity) - (b.adp ?? Infinity) || a.name.localeCompare(b.name),
  ).slice(0, limit)
}

export function isFootballDraftSport(sport: string | LeagueSport | null | undefined): boolean {
  return normalizeToSupportedSport(sport) === 'NFL'
}

export async function loadSportAwareDraftPlayerPool(params: {
  sport: string | LeagueSport
  leagueId?: string | null
  limit: number
  format?: 'redraft' | 'dynasty'
}): Promise<SportAwareDraftPlayer[]> {
  const sport = normalizeToSupportedSport(params.sport)
  const fetchLimit = sport === 'NBA' ? 5000 : params.limit
  const rows = params.leagueId
    ? await getPlayerPoolForLeague(params.leagueId, sport, { limit: fetchLimit })
    : await getPlayerPoolForSport(sport, { limit: fetchLimit })

  if (sport === 'NBA') {
    const [eligibility, market] = await Promise.all([
      loadNbaSurvivorRosterEligibility(1),
      loadLatestAveragedAdpRowsFromDb('NBA', params.format ?? 'redraft', false,
        { season: new Date().getUTCFullYear(), scoring: 'Points' }, { allowLiveImport: false }),
    ])
    return selectVerifiedNbaMockPlayers(rows, eligibility, market, params.limit)
  }

  return rows
    .map((player, index) => ({
      name: player.full_name,
      position: player.position || 'UTIL',
      team: player.team_abbreviation ?? null,
      adp: index + 1,
      value: Math.max(1, params.limit - index),
      playerId: player.external_source_id ?? player.player_id,
      sport,
      source: 'sports-player-pool' as const,
      age: player.age ?? null,
    }))
    .filter((player) => Boolean(player.name))
}

export function toSyntheticAdpEntries(players: SportAwareDraftPlayer[]): ADPEntry[] {
  return players.map((player) => ({
    name: player.name,
    position: player.position,
    team: player.team ?? null,
    adp: Number(player.adp ?? 999),
    adpFormatted: player.adp != null ? player.adp.toFixed(1) : null,
    adpTrend: null,
    age: player.age ?? null,
    value: player.value ?? null,
    source: 'analytics',
    ffcPlayerId: null,
    timesDrafted: null,
    adpHigh: null,
    adpLow: null,
    adpStdev: null,
    bye: null,
  }))
}
