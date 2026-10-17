import type { SeasonRules } from './seasonRules'
import { assessSeasonRiNbaCoverage, mapSeasonRiNbaStats } from './seasonStatAdapter'

type BoxAudit = {
  measuredSport: boolean
  gamesWithPlayerBoxes: number
  providerPlayerRows: number
  missingBoxGameIds: string[]
  malformedBoxGameIds: string[]
  duplicatePlayerGameIds: string[]
  invalidWeightedBoxGameIds: string[]
  unscorableWeightedStats: string[]
  draftedPlayerCoverageVerified: false
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** A usable measured NBA box needs both sides and unambiguous provider player IDs. */
export function readMeasuredNbaPlayerBoxIds(raw: Record<string, unknown>): Set<string> | null {
  const box = record(raw.player_box), away = record(box?.away_team), home = record(box?.home_team)
  if (!away || !home || !Object.keys(away).length || !Object.keys(home).length) return null
  const ids = new Set<string>()
  for (const [id, line] of [...Object.entries(away), ...Object.entries(home)]) {
    if (!id.trim() || id.length > 200 || !record(line) || ids.has(id)) return null
    ids.add(id)
  }
  return ids
}

/** Measured NBA shape only. This cannot establish that every drafted player appears in a game. */
export function auditSeasonPeriodPlayerBoxes(input: {
  sport: 'NBA' | 'NFL'; rules: SeasonRules; rawGames: Map<string, Record<string, unknown>>
}): BoxAudit {
  const result: BoxAudit = {
    measuredSport: input.sport === 'NBA', gamesWithPlayerBoxes: 0, providerPlayerRows: 0,
    missingBoxGameIds: [], malformedBoxGameIds: [], duplicatePlayerGameIds: [], invalidWeightedBoxGameIds: [],
    unscorableWeightedStats: [], draftedPlayerCoverageVerified: false,
  }
  if (input.sport !== 'NBA') return result
  const coverage = assessSeasonRiNbaCoverage(input.rules)
  result.unscorableWeightedStats = [...coverage.needsOtherFeed, ...coverage.unsupported].sort()
  const supported = new Set([...coverage.measured, ...coverage.derived])
  const supportedRules = { ...input.rules, weights: input.rules.weights.filter(weight => supported.has(weight.statKey)) }
  for (const [gameId, raw] of input.rawGames) {
    const box = record(raw.player_box)
    if (!box) { result.missingBoxGameIds.push(gameId); continue }
    const away = record(box.away_team), home = record(box.home_team)
    if (!away || !home) { result.malformedBoxGameIds.push(gameId); continue }
    if (!Object.keys(away).length || !Object.keys(home).length) { result.missingBoxGameIds.push(gameId); continue }
    const seen = new Set<string>()
    let malformed = false, duplicate = false, invalidWeighted = false
    for (const [playerId, rawLine] of [...Object.entries(away), ...Object.entries(home)]) {
      const line = record(rawLine)
      if (!playerId.trim() || playerId.length > 200 || !line) { malformed = true; continue }
      if (seen.has(playerId)) { duplicate = true; continue }
      seen.add(playerId)
      if (supportedRules.weights.length) {
        try { mapSeasonRiNbaStats(supportedRules, line) } catch { invalidWeighted = true }
      }
    }
    if (malformed) result.malformedBoxGameIds.push(gameId)
    if (duplicate) result.duplicatePlayerGameIds.push(gameId)
    if (invalidWeighted) result.invalidWeightedBoxGameIds.push(gameId)
    if (!malformed && !duplicate) { result.gamesWithPlayerBoxes++; result.providerPlayerRows += seen.size }
  }
  for (const key of ['missingBoxGameIds', 'malformedBoxGameIds', 'duplicatePlayerGameIds', 'invalidWeightedBoxGameIds'] as const) result[key].sort()
  return result
}
