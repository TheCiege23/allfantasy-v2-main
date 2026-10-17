import type { NormalizedImportResult } from './types'

export const IMPORTED_POINTS_AGAINST_KEY = 'imported_points_against'
const object = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

/** Source evidence survives the non-null LeagueTeam column's default zero. Republished on sync. */
export function importedPointsAgainstSnapshot(normalized: Pick<NormalizedImportResult, 'league' | 'rosters' | 'standings'>) {
  const byTeamId: Record<string, number> = Object.create(null)
  for (const row of [...(normalized.standings ?? []), ...(normalized.rosters ?? [])]) {
    if (typeof row.points_against === 'number' && Number.isFinite(row.points_against)) {
      byTeamId[row.source_team_id] = row.points_against
    }
  }
  return { season: normalized.league.season, byTeamId }
}

export function readImportedPointsAgainst(input: {
  settings: unknown; platform: string | null; season: number; externalId: string; persisted: number
}): number | null {
  const snapshot = object(object(input.settings)?.[IMPORTED_POINTS_AGAINST_KEY])
  const totals = object(snapshot?.byTeamId)
  const value = totals && Object.hasOwn(totals, input.externalId) ? totals[input.externalId] : undefined
  if (snapshot?.season === input.season && typeof value === 'number' && Number.isFinite(value)) return value
  // These older adapters omitted the field; their stored zero cannot establish a reported total.
  if (['fantrax', 'sleeper'].includes(input.platform?.toLowerCase() ?? '')) return null
  return input.persisted
}
