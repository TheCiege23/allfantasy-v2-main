/**
 * Client + API safety filter: hide ranking/profile-import artifacts and invalid rows
 * after Prisma `where` clauses (see /api/league/list).
 */

type LeagueFilterRecord = {
  name?: string | null
  leagueVariant?: string | null
  league_variant?: string | null
  leagueSize?: number | null
  teamCount?: number | null
  totalTeams?: number | null
  status?: string | null
  platform?: string | null
  settings?: unknown
}

export const EXCLUDED_VARIANTS = new Set([
  "ranking",
  "rankings",
  "rank_only",
  "legacy_summary",
  "profile_import",
  "career_import",
])

export const EXCLUDED_STATUSES = new Set([
  "ranking_only",
  "artifact",
  "profile_import",
  "career_data",
])

function settingsFlagRankImportOnly(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false
  return (settings as { rankImportOnly?: unknown }).rankImportOnly === true
}

export function isRealLeague(record: LeagueFilterRecord): boolean {
  const name = record.name?.trim()
  if (!name) return false

  if (settingsFlagRankImportOnly(record.settings)) return false

  const teamCount =
    record.leagueSize ??
    record.teamCount ??
    record.totalTeams ??
    0
  if (teamCount <= 0) return false

  const variant = (record.leagueVariant ?? record.league_variant ?? "").toLowerCase().trim()
  if (variant && EXCLUDED_VARIANTS.has(variant)) return false

  const status = (record.status ?? "").toLowerCase().trim()
  if (status && EXCLUDED_STATUSES.has(status)) return false

  // Ranking-import-only leagues: created by legacy career import, never by an active league
  // import. Real Sleeper active imports always write `status` from the Sleeper API (e.g.
  // "pre_draft", "in_season", "complete"). A null status on a Sleeper league means it was
  // created only by the ranking import and should be hidden from My Leagues.
  const platform = (record.platform ?? "").toLowerCase().trim()
  if (platform === 'sleeper' && !variant && !status) return false

  return true
}
