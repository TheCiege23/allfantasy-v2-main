import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assembleCanonicalWorld } from '@/lib/decision-os/world/assemble'
import { projectEnrichedWorld } from '@/lib/decision-os/world/enrichedWorld'
import {
  deriveWeatherRiskCategory,
  projectWeatherFreshness,
  projectWeatherContext,
  projectWeatherEnrichedWorld,
  resolveWeatherContext,
  resolveWeatherEnrichedCanonicalWorld,
  type WeatherContextResult,
} from '@/lib/decision-os/world/weatherEnrichedWorld'
import type {
  CanonicalWorld,
  NormalizedPlayerMetadata,
  PlayerMetadataResult,
  RawWeatherRow,
} from '@/lib/decision-os/world'
import { makeImportedProviderWorld, makeNativeAfWorld } from './canonicalWorldFakes'

const NOW = new Date('2026-06-30T12:00:00.000Z')
const FRESH_EXPIRES = new Date('2026-06-30T13:00:00.000Z') // 1h from NOW — fresh
const STALE_EXPIRES = new Date('2026-06-30T10:00:00.000Z') // 2h before NOW — stale
const FRESH_FETCHED = new Date('2026-06-30T12:00:00.000Z')

const assemble = (input: Parameters<typeof assembleCanonicalWorld>[0]): CanonicalWorld =>
  assembleCanonicalWorld(input, { now: NOW })

function idsOf(world: CanonicalWorld): string[] {
  return Array.from(new Set(world.rosters.flatMap((r) => r.playerIds)))
}

function meta(ids: string[], team = 'BUF'): PlayerMetadataResult {
  const byId = new Map<string, NormalizedPlayerMetadata>()
  for (const id of ids) {
    byId.set(id, {
      playerId: id, name: `Name ${id}`, position: 'RB', team,
      injuryStatus: null, byeWeek: null, projectedPoints: null,
      projectionConfidence: null, source: 'sports_player_cache', resolved: true,
    })
  }
  return { byId, complete: true, unresolvedIds: [], warnings: [] }
}

function weatherRow(team: string, opts: Partial<RawWeatherRow> = {}): RawWeatherRow {
  return {
    cacheKey: `weather:team-window:${team}:2026-09-08`,
    sport: 'NFL',
    eventId: null,
    temperatureF: 68,
    feelsLikeF: 66,
    windSpeedMph: 8,
    windGustsMph: 12,
    windDirectionDeg: 270,
    precipChancePct: 20,
    rainInches: 0,
    snowInches: 0,
    conditionCode: '800',
    conditionLabel: 'clear sky',
    isIndoor: false,
    isDome: false,
    roofClosed: false,
    fetchedAt: FRESH_FETCHED,
    expiresAt: FRESH_EXPIRES,
    dataSource: 'openweathermap',
    ...opts,
  }
}

function emptyContextResult(): WeatherContextResult {
  return { rowsByTeam: new Map(), error: null }
}

function contextResultFrom(rows: Array<{ team: string; row: RawWeatherRow }>): WeatherContextResult {
  const rowsByTeam = new Map<string, RawWeatherRow>()
  for (const { team, row } of rows) rowsByTeam.set(team.toUpperCase(), row)
  return { rowsByTeam, error: null }
}

// ──────────────────────────────────────────────────────────────────────────
// deriveWeatherRiskCategory — all 7 tiers
// ──────────────────────────────────────────────────────────────────────────

describe('deriveWeatherRiskCategory', () => {
  it('returns not_applicable for non-weather-sensitive sport (NBA)', () => {
    const row = weatherRow('MIL', { windSpeedMph: 40 })
    expect(deriveWeatherRiskCategory(row, 'NBA')).toBe('not_applicable')
  })

  it('returns indoor when isDome is true', () => {
    const row = weatherRow('NO', { isDome: true, windSpeedMph: 5 })
    expect(deriveWeatherRiskCategory(row, 'NFL')).toBe('indoor')
  })

  it('returns indoor when isIndoor is true', () => {
    const row = weatherRow('LV', { isIndoor: true })
    expect(deriveWeatherRiskCategory(row, 'NFL')).toBe('indoor')
  })

  it('returns indoor when roofClosed is true', () => {
    const row = weatherRow('MIN', { roofClosed: true })
    expect(deriveWeatherRiskCategory(row, 'NFL')).toBe('indoor')
  })

  it('returns extreme when wind >= 35 mph', () => {
    const row = weatherRow('BUF', { windSpeedMph: 35, isDome: false, isIndoor: false, roofClosed: false })
    expect(deriveWeatherRiskCategory(row, 'NFL')).toBe('extreme')
  })

  it('returns extreme when wind >= 25 with snow', () => {
    const row = weatherRow('GB', { windSpeedMph: 26, snowInches: 0.1, isDome: false, isIndoor: false, roofClosed: false })
    expect(deriveWeatherRiskCategory(row, 'NFL')).toBe('extreme')
  })

  it('returns extreme when wind >= 25 with heavy rain', () => {
    const row = weatherRow('NE', { windSpeedMph: 25, rainInches: 0.3, isDome: false, isIndoor: false, roofClosed: false })
    expect(deriveWeatherRiskCategory(row, 'NFL')).toBe('extreme')
  })

  it('returns high when wind >= 25 (no precip)', () => {
    const row = weatherRow('CHI', { windSpeedMph: 25, isDome: false, isIndoor: false, roofClosed: false })
    expect(deriveWeatherRiskCategory(row, 'NFL')).toBe('high')
  })

  it('returns high when snow > 0 with wind >= 15', () => {
    const row = weatherRow('DEN', { windSpeedMph: 15, snowInches: 0.05, isDome: false, isIndoor: false, roofClosed: false })
    expect(deriveWeatherRiskCategory(row, 'NFL')).toBe('high')
  })

  it('returns moderate when wind >= 15 (no snow)', () => {
    const row = weatherRow('SEA', { windSpeedMph: 15, isDome: false, isIndoor: false, roofClosed: false })
    expect(deriveWeatherRiskCategory(row, 'NFL')).toBe('moderate')
  })

  it('returns moderate when precipChancePct > 60', () => {
    const row = weatherRow('MIA', { windSpeedMph: 5, precipChancePct: 65, isDome: false, isIndoor: false, roofClosed: false })
    expect(deriveWeatherRiskCategory(row, 'NFL')).toBe('moderate')
  })

  it('returns moderate when any snow (low wind)', () => {
    const row = weatherRow('CLE', { windSpeedMph: 5, snowInches: 0.1, isDome: false, isIndoor: false, roofClosed: false })
    expect(deriveWeatherRiskCategory(row, 'NFL')).toBe('moderate')
  })

  it('returns moderate when temp < 20°F', () => {
    const row = weatherRow('GB', { temperatureF: 10, windSpeedMph: 5, isDome: false, isIndoor: false, roofClosed: false })
    expect(deriveWeatherRiskCategory(row, 'NFL')).toBe('moderate')
  })

  it('returns low when wind >= 10 mph (no other factors)', () => {
    const row = weatherRow('PHI', { windSpeedMph: 10, isDome: false, isIndoor: false, roofClosed: false })
    expect(deriveWeatherRiskCategory(row, 'NFL')).toBe('low')
  })

  it('returns low when temp < 32°F (low wind)', () => {
    const row = weatherRow('NE', { temperatureF: 28, windSpeedMph: 5, isDome: false, isIndoor: false, roofClosed: false })
    expect(deriveWeatherRiskCategory(row, 'NFL')).toBe('low')
  })

  it('returns none for mild conditions', () => {
    const row = weatherRow('LAR', { temperatureF: 72, windSpeedMph: 5, precipChancePct: 10, isDome: false, isIndoor: false, roofClosed: false })
    expect(deriveWeatherRiskCategory(row, 'NFL')).toBe('none')
  })

  it('extreme tier takes precedence over indoor flag — indoor check first', () => {
    // isIndoor true → must return indoor even with extreme wind
    const row = weatherRow('DAL', { isDome: true, windSpeedMph: 45 })
    expect(deriveWeatherRiskCategory(row, 'NFL')).toBe('indoor')
  })

  it('works for weather-sensitive non-NFL sport (NCAAF)', () => {
    const row = weatherRow('OSU', { windSpeedMph: 20, isDome: false, isIndoor: false, roofClosed: false })
    expect(deriveWeatherRiskCategory(row, 'NCAAF')).toBe('moderate')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectWeatherFreshness
// ──────────────────────────────────────────────────────────────────────────

describe('projectWeatherFreshness', () => {
  it('returns fresh when expiresAt is in the future', () => {
    const row = weatherRow('BUF', { expiresAt: FRESH_EXPIRES })
    const f = projectWeatherFreshness(row, NOW)
    expect(f.isStale).toBe(false)
    expect(f.staleReason).toBeNull()
    expect(f.expiresAt).toEqual(FRESH_EXPIRES)
  })

  it('returns stale when expiresAt is in the past', () => {
    const row = weatherRow('BUF', { expiresAt: STALE_EXPIRES })
    const f = projectWeatherFreshness(row, NOW)
    expect(f.isStale).toBe(true)
    expect(f.staleReason).toBe('weather_stale')
  })

  it('returns null freshness when no row', () => {
    const f = projectWeatherFreshness(null, NOW)
    expect(f.isStale).toBeNull()
    expect(f.expiresAt).toBeNull()
    expect(f.staleReason).toBe('weather_freshness_unavailable')
  })

  it('carries fetchedAt', () => {
    const row = weatherRow('KC', { fetchedAt: FRESH_FETCHED })
    const f = projectWeatherFreshness(row, NOW)
    expect(f.fetchedAt).toEqual(FRESH_FETCHED)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectWeatherContext
// ──────────────────────────────────────────────────────────────────────────

describe('projectWeatherContext', () => {
  it('returns not_applicable for non-weather-sensitive sport with no uncertainty', () => {
    const ctx = projectWeatherContext(null, 'MIL', 'NBA', NOW)
    expect(ctx.weatherRiskCategory).toBe('not_applicable')
    expect(ctx.uncertainty).toHaveLength(0)
    expect(ctx.temperatureF).toBeNull()
  })

  it('adds weather_team_unknown when team is null for outdoor sport', () => {
    const ctx = projectWeatherContext(null, null, 'NFL', NOW)
    expect(ctx.uncertainty).toContain('weather_team_unknown')
    expect(ctx.weatherRiskCategory).toBe('unknown')
  })

  it('adds weather_cache_miss when row is null but team is known', () => {
    const ctx = projectWeatherContext(null, 'BUF', 'NFL', NOW)
    expect(ctx.uncertainty).toContain('weather_cache_miss')
    expect(ctx.temperatureF).toBeNull()
    expect(ctx.weatherRiskCategory).toBe('unknown')
  })

  it('returns full weather context on fresh row', () => {
    const row = weatherRow('BUF', { temperatureF: 55, windSpeedMph: 8, expiresAt: FRESH_EXPIRES })
    const ctx = projectWeatherContext(row, 'BUF', 'NFL', NOW)
    expect(ctx.temperatureF).toBe(55)
    expect(ctx.windSpeedMph).toBe(8)
    expect(ctx.dataSource).toBe('openweathermap')
    expect(ctx.teamAbbrev).toBe('BUF')
    expect(ctx.freshness.isStale).toBe(false)
    expect(ctx.uncertainty).toHaveLength(0)
  })

  it('adds weather_stale on stale row', () => {
    const row = weatherRow('BUF', { expiresAt: STALE_EXPIRES })
    const ctx = projectWeatherContext(row, 'BUF', 'NFL', NOW)
    expect(ctx.freshness.isStale).toBe(true)
    expect(ctx.uncertainty).toContain('weather_stale')
  })

  it('returns indoor risk category when isDome is true', () => {
    const row = weatherRow('NO', { isDome: true })
    const ctx = projectWeatherContext(row, 'NO', 'NFL', NOW)
    expect(ctx.weatherRiskCategory).toBe('indoor')
    expect(ctx.isIndoor).toBe(true)
  })

  it('isIndoor is true when any of isDome, isIndoor, roofClosed is set', () => {
    const domeless = weatherRow('LV', { isDome: false, isIndoor: true, roofClosed: false })
    const ctx = projectWeatherContext(domeless, 'LV', 'NFL', NOW)
    expect(ctx.isIndoor).toBe(true)
    expect(ctx.weatherRiskCategory).toBe('indoor')
  })

  it('returns extreme risk for extreme wind conditions', () => {
    const row = weatherRow('BUF', { windSpeedMph: 40, isDome: false, isIndoor: false, roofClosed: false })
    const ctx = projectWeatherContext(row, 'BUF', 'NFL', NOW)
    expect(ctx.weatherRiskCategory).toBe('extreme')
    expect(ctx.uncertainty).not.toContain('weather_cache_miss')
  })

  it('carries all weather fields from row', () => {
    const row = weatherRow('KC', {
      temperatureF: 45, feelsLikeF: 40, windSpeedMph: 20, windGustsMph: 28,
      windDirectionDeg: 180, precipChancePct: 30, rainInches: 0.1, snowInches: 0,
      conditionCode: '500', conditionLabel: 'light rain',
    })
    const ctx = projectWeatherContext(row, 'KC', 'NFL', NOW)
    expect(ctx.feelsLikeF).toBe(40)
    expect(ctx.windGustsMph).toBe(28)
    expect(ctx.windDirectionDeg).toBe(180)
    expect(ctx.precipChancePct).toBe(30)
    expect(ctx.rainInches).toBe(0.1)
    expect(ctx.snowInches).toBe(0)
    expect(ctx.conditionCode).toBe('500')
    expect(ctx.conditionLabel).toBe('light rain')
  })

  it('carries null fields from row when present', () => {
    const row = weatherRow('DET', { feelsLikeF: null, windGustsMph: null })
    const ctx = projectWeatherContext(row, 'DET', 'NFL', NOW)
    expect(ctx.feelsLikeF).toBeNull()
    expect(ctx.windGustsMph).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectWeatherEnrichedWorld — no mutation
// ──────────────────────────────────────────────────────────────────────────

describe('projectWeatherEnrichedWorld — no mutation', () => {
  it('does not mutate the base enriched world', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))
    const frozen = JSON.stringify(enriched)

    projectWeatherEnrichedWorld(enriched, emptyContextResult(), 'NFL', NOW)

    expect(JSON.stringify(enriched)).toBe(frozen)
  })

  it('weather layer does not appear on base rosters', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))

    expect((enriched.rosters[0]?.players[0] as Record<string, unknown>)['weatherContext']).toBeUndefined()
  })

  it('base EnrichedCanonicalWorld fields are preserved on projected world', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))

    const projected = projectWeatherEnrichedWorld(enriched, emptyContextResult(), 'NFL', NOW)
    expect(projected.league).toEqual(enriched.league)
    expect(projected.teams).toEqual(enriched.teams)
    expect(projected.provenance).toEqual(enriched.provenance)
    expect(projected.completeness).toEqual(enriched.completeness)
    expect(projected.metadata).toEqual(enriched.metadata)
    expect(projected.leagueFacts).toEqual(enriched.leagueFacts)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectWeatherEnrichedWorld — summary counts
// ──────────────────────────────────────────────────────────────────────────

describe('projectWeatherEnrichedWorld — summary', () => {
  it('counts totalPlayers correctly', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))

    const projected = projectWeatherEnrichedWorld(enriched, emptyContextResult(), 'NFL', NOW)
    expect(projected.weatherSummary.totalPlayers).toBe(ids.length)
  })

  it('counts missingCount when no weather data', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))

    const projected = projectWeatherEnrichedWorld(enriched, emptyContextResult(), 'NFL', NOW)
    // All players have team 'BUF' but no row in context → all missing
    expect(projected.weatherSummary.missingCount).toBe(ids.length)
  })

  it('counts withWeather when weather row present', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    // meta assigns all players to 'BUF'
    const enriched = projectEnrichedWorld(world, meta(ids, 'BUF'))

    const result = contextResultFrom([{ team: 'BUF', row: weatherRow('BUF') }])
    const projected = projectWeatherEnrichedWorld(enriched, result, 'NFL', NOW)
    // All players on BUF → all get weather data
    expect(projected.weatherSummary.withWeather).toBe(ids.length)
    expect(projected.weatherSummary.missingCount).toBe(0)
  })

  it('counts indoorCount for dome teams', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids, 'NO'))

    const result = contextResultFrom([{ team: 'NO', row: weatherRow('NO', { isDome: true }) }])
    const projected = projectWeatherEnrichedWorld(enriched, result, 'NFL', NOW)
    expect(projected.weatherSummary.indoorCount).toBe(ids.length)
    expect(projected.weatherSummary.withWeather).toBe(ids.length)
  })

  it('counts staleCount for stale rows', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids, 'BUF'))

    const result = contextResultFrom([{ team: 'BUF', row: weatherRow('BUF', { expiresAt: STALE_EXPIRES }) }])
    const projected = projectWeatherEnrichedWorld(enriched, result, 'NFL', NOW)
    expect(projected.weatherSummary.staleCount).toBe(ids.length)
  })

  it('counts notApplicableCount for non-outdoor sport', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids, 'BUF'))

    const projected = projectWeatherEnrichedWorld(enriched, emptyContextResult(), 'NBA', NOW)
    expect(projected.weatherSummary.notApplicableCount).toBe(ids.length)
    expect(projected.weatherSummary.missingCount).toBe(0)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Origin-blind shape
// ──────────────────────────────────────────────────────────────────────────

describe('origin-blind shape', () => {
  it('imported and native worlds produce the same WeatherEnrichedPlayer shape', () => {
    const importedWorld = assemble(makeImportedProviderWorld())
    const nativeWorld = assemble(makeNativeAfWorld())

    const importedIds = idsOf(importedWorld)
    const nativeIds = idsOf(nativeWorld)

    const importedEnriched = projectEnrichedWorld(importedWorld, meta(importedIds))
    const nativeEnriched = projectEnrichedWorld(nativeWorld, meta(nativeIds))

    const importedProjected = projectWeatherEnrichedWorld(importedEnriched, emptyContextResult(), 'NFL', NOW)
    const nativeProjected = projectWeatherEnrichedWorld(nativeEnriched, emptyContextResult(), 'NFL', NOW)

    const importedKeys = Object.keys(importedProjected.rosters[0]?.players[0] ?? {}).sort()
    const nativeKeys = Object.keys(nativeProjected.rosters[0]?.players[0] ?? {}).sort()
    expect(importedKeys).toEqual(nativeKeys)
  })

  it('provenance does not leak into weatherContext fields', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids, 'BUF'))

    const result = contextResultFrom([{ team: 'BUF', row: weatherRow('BUF', { expiresAt: FRESH_EXPIRES }) }])
    const projected = projectWeatherEnrichedWorld(enriched, result, 'NFL', NOW)

    const ctx = projected.rosters[0]!.players[0]!.weatherContext
    const ctxStr = JSON.stringify(ctx)
    expect(ctxStr).not.toContain('sleeper')
    expect(ctxStr).not.toContain('platformLeagueId')
    expect(ctxStr).not.toContain('"provider"')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// resolveWeatherContext — never throws
// ──────────────────────────────────────────────────────────────────────────

describe('resolveWeatherContext — never throws', () => {
  it('returns empty map with null error when teamAbbrevs is empty', async () => {
    const result = await resolveWeatherContext([], {
      loadWeatherRows: async () => { throw new Error('should not be called') },
    })
    expect(result.rowsByTeam.size).toBe(0)
    expect(result.error).toBeNull()
  })

  it('surfaces port error as result.error without throwing', async () => {
    const result = await resolveWeatherContext(['BUF'], {
      loadWeatherRows: async () => { throw new Error('db connection failed') },
    })
    expect(result.error).toBe('db connection failed')
    expect(result.rowsByTeam.size).toBe(0)
  })

  it('groups rows by team from cacheKey', async () => {
    const rows = [
      weatherRow('BUF', { expiresAt: FRESH_EXPIRES }),
      weatherRow('KC', { expiresAt: STALE_EXPIRES }),
    ]
    const result = await resolveWeatherContext(['BUF', 'KC'], {
      loadWeatherRows: async () => rows,
    })
    expect(result.rowsByTeam.has('BUF')).toBe(true)
    expect(result.rowsByTeam.has('KC')).toBe(true)
    expect(result.rowsByTeam.size).toBe(2)
    expect(result.error).toBeNull()
  })

  it('takes freshest row per team (port orders by expiresAt desc, first wins)', async () => {
    // Port returns two rows for BUF — first is fresher (port ordered desc)
    const fresh = weatherRow('BUF', { expiresAt: FRESH_EXPIRES, temperatureF: 65 })
    const stale = weatherRow('BUF', { expiresAt: STALE_EXPIRES, temperatureF: 40 })
    const result = await resolveWeatherContext(['BUF'], {
      loadWeatherRows: async () => [fresh, stale],
    })
    expect(result.rowsByTeam.get('BUF')?.temperatureF).toBe(65)
  })

  it('normalizes team key to uppercase', async () => {
    const rows = [weatherRow('BUF')]
    const result = await resolveWeatherContext(['buf'], {
      loadWeatherRows: async () => rows,
    })
    expect(result.rowsByTeam.has('BUF')).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// resolveWeatherEnrichedCanonicalWorld — never throws
// ──────────────────────────────────────────────────────────────────────────

describe('resolveWeatherEnrichedCanonicalWorld — never throws', () => {
  it('returns null for unknown leagueId without throwing', async () => {
    const result = await resolveWeatherEnrichedCanonicalWorld('nonexistent-league-id-xyz')
    expect(result).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Architecture guard — source file is read-only substrate
// ──────────────────────────────────────────────────────────────────────────

describe('architecture guard', () => {
  it('weatherEnrichedWorld.ts contains no direct prisma import', () => {
    const src = readFileSync(
      resolvePath('lib/decision-os/world/weatherEnrichedWorld.ts'),
      'utf-8',
    )
    expect(src).not.toContain("from '@/lib/prisma'")
  })

  it('weatherEnrichedWorld.ts contains no mutation keywords', () => {
    const src = readFileSync(
      resolvePath('lib/decision-os/world/weatherEnrichedWorld.ts'),
      'utf-8',
    )
    expect(src).not.toContain('.create(')
    expect(src).not.toContain('.update(')
    expect(src).not.toContain('.upsert(')
    expect(src).not.toContain('.delete(')
  })

  it('weatherEnrichedWorld.ts does not import AI or live-API engines', () => {
    const src = readFileSync(
      resolvePath('lib/decision-os/world/weatherEnrichedWorld.ts'),
      'utf-8',
    )
    expect(src).not.toContain('weatherImpactEngine')
    expect(src).not.toContain('calculateWeatherImpact')
    expect(src).not.toContain('openweathermap')
    expect(src).not.toContain('AFProjectionSnapshot')
  })

  it('weatherEnrichedWorld.ts does not alter projections directly', () => {
    const src = readFileSync(
      resolvePath('lib/decision-os/world/weatherEnrichedWorld.ts'),
      'utf-8',
    )
    expect(src).not.toContain('projectedPoints')
    expect(src).not.toContain('projectionContext')
  })
})
