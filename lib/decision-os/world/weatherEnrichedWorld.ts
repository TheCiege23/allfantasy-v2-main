/**
 * Decision OS — Phase 2 Canonical Enrichment: F2.6 Weather Context derived VIEW.
 *
 * Additive, read-only view layering on F2.1 EnrichedCanonicalWorld. Exposes deterministic
 * game-weather context (from already-persisted `WeatherCache` rows only) with team-level grouping,
 * expiresAt-based freshness, a pure risk-category tier, and honest degradation via null + uncertainty[].
 *
 * Architecture Freeze invariants (must hold forever):
 * - Pure `CanonicalWorld` is NOT mutated. All weather data lives on this derived view only.
 * - Origin (provider / native) is NEVER used as a decision input. Provenance only.
 * - No live API calls, no cache warming, no writes. Port reads only already-persisted rows.
 * - All fields degrade to null + uncertainty[] when data is unavailable (P2 — never fabricate).
 * - Weather is team-level: all players on the same team share the same WeatherContext row.
 * - `resolveWeatherEnrichedCanonicalWorld` NEVER throws; errors surface as uncertainty entries.
 * - Projection adjustment is NOT performed here (ticket rule: "do not alter projections directly").
 * - `WeatherRiskCategory` is derived from raw conditions only — position-agnostic, no baseline.
 *
 * See ADR_F2_6_WEATHER.md for source audit, join strategy, risk-tier logic, and real-data results.
 */

import type { EnrichedCanonicalWorld, EnrichedPlayer } from './enrichedWorld'
import { resolveEnrichedCanonicalWorld } from './enrichedWorld'
import type { RawWeatherRow } from './facts'
import { loadWeatherRows } from './port'
import { isWeatherSensitiveSport } from '@/lib/weather/outdoorSportMetadata'

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

/**
 * Deterministic risk tier derived from raw game conditions only (no projection baseline needed).
 * 'not_applicable' = sport is not weather-sensitive (NBA, NHL, etc.).
 * 'indoor'         = venue is dome, indoor, or roof closed.
 * 'unknown'        = sport IS weather-sensitive, but no cache data available (cache miss / team unknown).
 * 'none' … 'extreme' = increasing severity of outdoor conditions.
 */
export type WeatherRiskCategory = 'not_applicable' | 'indoor' | 'unknown' | 'none' | 'low' | 'moderate' | 'high' | 'extreme'

export interface WeatherFreshness {
  expiresAt: Date | null
  fetchedAt: Date | null
  isStale: boolean | null
  staleReason: string | null
}

export interface WeatherContext {
  temperatureF: number | null
  feelsLikeF: number | null
  windSpeedMph: number | null
  windGustsMph: number | null
  windDirectionDeg: number | null
  precipChancePct: number | null
  rainInches: number | null
  snowInches: number | null
  conditionCode: string | null
  conditionLabel: string | null
  /** True when the venue is determined to be sheltered from weather (dome/indoor/roof-closed). */
  isIndoor: boolean | null
  weatherRiskCategory: WeatherRiskCategory
  /** Team abbreviation used for the cache-key lookup (provenance). */
  teamAbbrev: string | null
  dataSource: string | null
  freshness: WeatherFreshness
  uncertainty: string[]
}

export interface WeatherEnrichedPlayer extends EnrichedPlayer {
  weatherContext: WeatherContext
}

export interface WeatherEnrichedRosterFacts {
  rosterId: string
  teamId: string
  players: WeatherEnrichedPlayer[]
}

export interface WeatherEnrichmentSummary {
  totalPlayers: number
  withWeather: number
  indoorCount: number
  staleCount: number
  missingCount: number
  notApplicableCount: number
}

export interface WeatherEnrichedCanonicalWorld extends EnrichedCanonicalWorld {
  rosters: WeatherEnrichedRosterFacts[]
  weatherSummary: WeatherEnrichmentSummary
}

/** Result type for the resolver (so callers never need to catch). */
export interface WeatherContextResult {
  rowsByTeam: Map<string, RawWeatherRow>
  error: string | null
}

export interface WeatherPort {
  loadWeatherRows(teamAbbrevs: string[]): Promise<RawWeatherRow[]>
}

export interface WeatherEnrichedWorldDeps {
  weather?: WeatherPort
  now?: Date
}

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Derive weather risk category from raw conditions — pure, never throws.
 * Evaluated in descending severity; first matching tier wins.
 * Preconditions: caller has already checked isWeatherSensitiveSport and indoor flags.
 */
export function deriveWeatherRiskCategory(row: RawWeatherRow, sport: string): WeatherRiskCategory {
  if (!isWeatherSensitiveSport(sport)) return 'not_applicable'
  if (row.isDome || row.isIndoor || row.roofClosed) return 'indoor'

  const wind = row.windSpeedMph ?? 0
  const snow = row.snowInches ?? 0
  const rain = row.rainInches ?? 0
  const precip = row.precipChancePct ?? 0
  const temp = row.temperatureF ?? 70

  // extreme: wind >= 35, OR wind >= 25 with snow or heavy rain
  if (wind >= 35) return 'extreme'
  if (wind >= 25 && (snow > 0 || rain > 0.2)) return 'extreme'

  // high: wind >= 25, OR snow with meaningful wind
  if (wind >= 25) return 'high'
  if (snow > 0 && wind >= 15) return 'high'

  // moderate: wind >= 15, OR heavy precip chance, OR any snow, OR very cold
  if (wind >= 15) return 'moderate'
  if (precip > 60) return 'moderate'
  if (snow > 0) return 'moderate'
  if (temp < 20) return 'moderate'

  // low: moderate wind OR below freezing
  if (wind >= 10) return 'low'
  if (temp < 32) return 'low'

  return 'none'
}

/** Compute weather freshness from a row's expiresAt. Direct TTL — no age estimation needed. */
export function projectWeatherFreshness(row: RawWeatherRow | null, now: Date): WeatherFreshness {
  if (!row) {
    return { expiresAt: null, fetchedAt: null, isStale: null, staleReason: 'weather_freshness_unavailable' }
  }
  const isStale = row.expiresAt <= now
  return {
    expiresAt: row.expiresAt,
    fetchedAt: row.fetchedAt,
    isStale,
    staleReason: isStale ? 'weather_stale' : null,
  }
}

/**
 * Build a WeatherContext for one player from the team-keyed row (or null on miss). Pure, never throws.
 * `team` is the player's team abbreviation (already uppercase per F2.1 metadata).
 * `sport` is the league sport.
 */
export function projectWeatherContext(
  row: RawWeatherRow | null,
  team: string | null,
  sport: string,
  now: Date,
): WeatherContext {
  const uncertainty: string[] = []

  // Not-applicable sport: skip all further processing
  if (!isWeatherSensitiveSport(sport)) {
    return {
      temperatureF: null,
      feelsLikeF: null,
      windSpeedMph: null,
      windGustsMph: null,
      windDirectionDeg: null,
      precipChancePct: null,
      rainInches: null,
      snowInches: null,
      conditionCode: null,
      conditionLabel: null,
      isIndoor: null,
      weatherRiskCategory: 'not_applicable',
      teamAbbrev: team,
      dataSource: null,
      freshness: { expiresAt: null, fetchedAt: null, isStale: null, staleReason: null },
      uncertainty: [],
    }
  }

  if (!team) {
    uncertainty.push('weather_team_unknown')
  }

  if (!row) {
    if (team) uncertainty.push('weather_cache_miss')
    return {
      temperatureF: null,
      feelsLikeF: null,
      windSpeedMph: null,
      windGustsMph: null,
      windDirectionDeg: null,
      precipChancePct: null,
      rainInches: null,
      snowInches: null,
      conditionCode: null,
      conditionLabel: null,
      isIndoor: null,
      // 'unknown' = sport IS weather-sensitive but no cached data available
      weatherRiskCategory: 'unknown',
      teamAbbrev: team,
      dataSource: null,
      freshness: { expiresAt: null, fetchedAt: null, isStale: null, staleReason: null },
      uncertainty,
    }
  }

  const freshness = projectWeatherFreshness(row, now)
  if (freshness.isStale === true) uncertainty.push('weather_stale')

  const isIndoor = row.isDome || row.isIndoor || row.roofClosed
  const weatherRiskCategory = deriveWeatherRiskCategory(row, sport)

  return {
    temperatureF: row.temperatureF,
    feelsLikeF: row.feelsLikeF,
    windSpeedMph: row.windSpeedMph,
    windGustsMph: row.windGustsMph,
    windDirectionDeg: row.windDirectionDeg,
    precipChancePct: row.precipChancePct,
    rainInches: row.rainInches,
    snowInches: row.snowInches,
    conditionCode: row.conditionCode,
    conditionLabel: row.conditionLabel,
    isIndoor,
    weatherRiskCategory,
    teamAbbrev: team,
    dataSource: row.dataSource,
    freshness,
    uncertainty,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Pure projector
// ──────────────────────────────────────────────────────────────────────────

/**
 * Fold weather context onto an EnrichedCanonicalWorld. Pure — never mutates base world,
 * never reads from DB.
 */
export function projectWeatherEnrichedWorld(
  world: EnrichedCanonicalWorld,
  contextResult: WeatherContextResult,
  sport: string,
  now: Date,
): WeatherEnrichedCanonicalWorld {
  const { rowsByTeam } = contextResult

  let totalPlayers = 0
  let withWeather = 0
  let indoorCount = 0
  let staleCount = 0
  let missingCount = 0
  let notApplicableCount = 0

  const rosters: WeatherEnrichedRosterFacts[] = world.rosters.map((roster) => ({
    rosterId: roster.rosterId,
    teamId: roster.teamId,
    players: roster.players.map((player) => {
      totalPlayers++
      const team = player.team ? player.team.toUpperCase() : null
      const row = team ? (rowsByTeam.get(team) ?? null) : null
      const ctx = projectWeatherContext(row, team, sport, now)

      if (ctx.weatherRiskCategory === 'not_applicable') notApplicableCount++
      else if (ctx.weatherRiskCategory === 'unknown') missingCount++
      else if (ctx.weatherRiskCategory === 'indoor') { withWeather++; indoorCount++ }
      else { withWeather++ }

      if (ctx.freshness.isStale === true) staleCount++

      return { ...player, weatherContext: ctx }
    }),
  }))

  return {
    ...world,
    rosters,
    weatherSummary: { totalPlayers, withWeather, indoorCount, staleCount, missingCount, notApplicableCount },
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Read-only resolver
// ──────────────────────────────────────────────────────────────────────────

export const defaultWeatherPort: WeatherPort = { loadWeatherRows }

/**
 * Load weather rows for a set of team abbreviations. Groups by team (first/freshest per team since
 * port orders by expiresAt desc). NEVER throws — errors surface as contextResult.error + empty map.
 */
export async function resolveWeatherContext(
  teamAbbrevs: string[],
  port?: WeatherPort,
): Promise<WeatherContextResult> {
  if (teamAbbrevs.length === 0) {
    return { rowsByTeam: new Map(), error: null }
  }
  const p = port ?? defaultWeatherPort
  try {
    const rows = await p.loadWeatherRows(teamAbbrevs)
    // Port orders by expiresAt desc; first row per team = freshest
    const rowsByTeam = new Map<string, RawWeatherRow>()
    for (const row of rows) {
      // Extract team from cacheKey: 'weather:team-window:{TEAM}:{DATE}'
      // split(':') → ['weather', 'team-window', 'BUF', '2026-10-01'] → team is parts[2]
      const parts = row.cacheKey.split(':')
      const team = parts[2]?.toUpperCase()
      if (team && team.length <= 5 && !rowsByTeam.has(team)) {
        rowsByTeam.set(team, row)
      }
    }
    return { rowsByTeam, error: null }
  } catch (err) {
    return {
      rowsByTeam: new Map(),
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Top-level orchestrator: chains F2.1 enrichment → resolves weather context → projects.
 * NEVER throws. Returns null when the league does not exist.
 */
export async function resolveWeatherEnrichedCanonicalWorld(
  leagueId: string,
  deps?: WeatherEnrichedWorldDeps,
): Promise<WeatherEnrichedCanonicalWorld | null> {
  const now = deps?.now ?? new Date()
  const base = await resolveEnrichedCanonicalWorld(leagueId).catch(() => null)
  if (!base) return null

  const sport = base.leagueFacts.sport

  // Collect unique team abbreviations from F2.1 player metadata
  const teamAbbrevs = Array.from(
    new Set(
      base.rosters
        .flatMap((r) => r.players.map((p) => p.team))
        .filter((t): t is string => typeof t === 'string' && t.length > 0)
        .map((t) => t.toUpperCase()),
    ),
  )

  const contextResult = await resolveWeatherContext(teamAbbrevs, deps?.weather)
  return projectWeatherEnrichedWorld(base, contextResult, sport, now)
}
