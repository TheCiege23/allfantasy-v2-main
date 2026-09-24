import {
  LEAGUE_CREATE_OPTIONS_CATALOG_V1,
  type LeagueCreateOptionsCatalog,
} from '@/lib/league-creation/options-catalog-seed-data'

let cachedCatalog: LeagueCreateOptionsCatalog | null = null

export function setClientLeagueCreateOptionsCatalog(catalog: LeagueCreateOptionsCatalog | null): void {
  cachedCatalog = catalog
}

/**
 * The catalog the wizard's rules read. Falls back to the static seed, which is the exact object
 * `POST /api/leagues` validates against (`getLeagueCreateOptionsCatalog` has no DB backing).
 *
 * It used to return `null` until `/api/leagues/create-options` resolved — and always `null` on
 * the server, where nothing sets it. Every rule then took a separate fallback branch whose
 * answers disagreed with the server's allowlist (unfiltered scoring presets, a 30-team cap the
 * catalog does not have), so the wizard passed choices the server rejected at submit.
 */
export function getClientLeagueCreateOptionsCatalog(): LeagueCreateOptionsCatalog {
  return cachedCatalog ?? LEAGUE_CREATE_OPTIONS_CATALOG_V1
}
