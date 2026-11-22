import type { NormalizedImportResult, NormalizedRoster } from '@/lib/league-import/types'

/**
 * Maps normalized provider data → `League` import_* columns for rank XP.
 * Aligns with Sleeper logic in `lib/import/processImportJob.ts` (playoff cutoff, standing === 1).
 */
type DerivedImportLeagueStats = {
  importWins: number
  importLosses: number
  importTies: number
  importMadePlayoffs: boolean
  importWonChampionship: boolean
  importFinalStanding: number | null
  importPointsFor: number | null
  importPointsAgainst: number | null
}

function resolveViewerRoster(normalized: NormalizedImportResult): NormalizedRoster | null {
  const viewerId = normalized.viewer_source_team_id?.trim() || null
  if (viewerId) {
    const match = normalized.rosters.find((r) => r.source_team_id === viewerId)
    if (match) return match
  }

  if (normalized.rosters.length === 1) {
    return normalized.rosters[0]!
  }

  if (normalized.source.source_provider === 'fantrax') {
    const userRoster = normalized.rosters.find((r) => r.source_manager_id.startsWith('fantrax-user:'))
    if (userRoster) return userRoster
  }

  return null
}

export function deriveImportStatsFromNormalized(normalized: NormalizedImportResult): DerivedImportLeagueStats | null {
  const roster = resolveViewerRoster(normalized)
  if (!roster) return null

  const leagueSize =
    typeof normalized.league.leagueSize === 'number' && normalized.league.leagueSize >= 1
      ? normalized.league.leagueSize
      : Math.max(1, normalized.rosters.length)

  const standing = normalized.standings.find((s) => s.source_team_id === roster.source_team_id)
  const rank = standing?.rank ?? null

  const playoffTeams =
    typeof normalized.league.playoff_team_count === 'number' && normalized.league.playoff_team_count >= 1
      ? Math.min(leagueSize, normalized.league.playoff_team_count)
      : Math.max(1, Math.ceil(leagueSize / 3))

  const madePlayoffs = rank != null && Number.isFinite(rank) ? rank <= playoffTeams : false
  const wonChampionship = rank === 1

  const pf =
    typeof roster.points_for === 'number' && Number.isFinite(roster.points_for) ? roster.points_for : null
  const paRaw = roster.points_against ?? standing?.points_against
  const pa = typeof paRaw === 'number' && Number.isFinite(paRaw) ? paRaw : null

  return {
    importWins: roster.wins,
    importLosses: roster.losses,
    importTies: roster.ties,
    importMadePlayoffs: madePlayoffs,
    importWonChampionship: wonChampionship,
    importFinalStanding: rank,
    importPointsFor: pf,
    importPointsAgainst: pa,
  }
}
