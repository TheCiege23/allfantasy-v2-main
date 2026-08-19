import {
  LEAGUE_CREATE_OPTIONS_CATALOG_V1,
  type LeagueCreateOptionsCatalog,
} from '@/lib/league-creation/options-catalog-seed-data'

export function getFallbackLeagueCreateOptionsCatalog(): LeagueCreateOptionsCatalog {
  return LEAGUE_CREATE_OPTIONS_CATALOG_V1
}

// `league_create_options_catalog` has no Prisma model and no migration in this
// codebase (verified — not defined in prisma/schema.prisma or prisma/migrations),
// so a DB-backed catalog was never actually shipped; this always returned the
// static fallback while also logging a Prisma "relation does not exist" error on
// every create-league page load. Returns the fallback directly until a real
// migration + seed step lands (see docs/CLOSED_BETA_UI_QA_FIXES.md).
export async function getLeagueCreateOptionsCatalog(): Promise<LeagueCreateOptionsCatalog> {
  return getFallbackLeagueCreateOptionsCatalog()
}

export function getAllowedSportsFromCatalog(catalog: LeagueCreateOptionsCatalog, concept: string): string[] {
  return catalog.allowedSportsByConcept[concept] ?? []
}

export function getAllowedDraftTypesFromCatalog(catalog: LeagueCreateOptionsCatalog, concept: string): string[] {
  return catalog.allowedDraftTypesByConcept[concept] ?? []
}

export function getAllowedScoringPresetsFromCatalog(
  catalog: LeagueCreateOptionsCatalog,
  concept: string,
  sport: string,
): string[] {
  const bySport = catalog.allowedScoringPresetsByConceptSport[concept]
  if (!bySport) return []
  return bySport[sport as keyof typeof bySport] ?? []
}

export function getAllowedTeamCountsFromCatalog(
  catalog: LeagueCreateOptionsCatalog,
  concept: string,
  sport: string,
): number[] {
  const bySport = catalog.teamCountOptionsByConceptSport[concept]
  if (!bySport) return []
  return bySport[sport as keyof typeof bySport] ?? []
}
