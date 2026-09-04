import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isWeatherSensitiveSport } from '@/lib/weather/outdoorSportMetadata'
import { calculateWeatherImpact, type WeatherAdjustmentFactor } from '@/lib/weather/weatherImpactEngine'
import { getWeatherForEvent, type NormalizedWeather } from '@/lib/weather/weatherService'

export type AFProjection = {
  playerId: string
  playerName: string
  sport: string
  position: string
  baselineProjection: number
  weatherAdjustment: number
  afProjection: number
  adjustmentFactors: WeatherAdjustmentFactor[]
  shortReason: string
  confidenceLevel: string
  isOutdoorGame: boolean
  hasWeatherData: boolean
  weatherSnapshot: {
    temperatureF: number | null
    windSpeedMph: number | null
    precipChancePct: number | null
    conditionLabel: string | null
  } | null
  computedAt: Date
}

const SNAPSHOT_TTL_MS = 30 * 60 * 1000

/**
 * The key weather's factors live under inside `adjustmentFactors`.
 *
 * 🛑 THIS EXISTS BECAUSE TWO SUBSYSTEMS WRITE ONE ROW AND ONE OF THEM WAS DESTROYING THE OTHER.
 * `AFProjectionSnapshot` is upserted on `snapshotLookupKey` by BOTH this service (on demand, from
 * `/api/weather/af-projection`) and by `lib/af-projections/writeAfProjectionSnapshots.ts` (the
 * scheduled engine). The engine writes `adjustmentFactors` as an OBJECT —
 * `{ basis, idpPreset, idp, kicker, perGameRates }` — and its rescore-at-read paths depend on it:
 * `rescoreIdpForLeague` reads `idp.componentAmounts` to reprice a defender under a league's own
 * tackle scoring, and `rescoreKickerForLeague` does the same for distance rules.
 *
 * This service used to write the column as a bare ARRAY of weather factors. Prisma replaces the
 * whole JSON value, so one weather lookup erased the engine's object. Nothing threw:
 * `rescoreIdpForLeague` reads `.idp` off an array, gets `undefined`, and returns null — which every
 * caller correctly treats as "no better information available, keep the stored value". So the
 * league's own IDP scoring silently stopped applying and the balanced-preset number stood in for
 * it, roughly half right for a tackle-heavy league, with a weather request as the only cause.
 *
 * Nesting under one key means each subsystem writes only its own branch. See
 * `__tests__/af-projections/weatherSnapshotCollision.test.ts`, which pins both directions.
 */
export const WEATHER_FACTORS_KEY = 'weather'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Read weather factors out of whichever shape the row happens to carry.
 *
 * ⚠ THE BARE-ARRAY BRANCH IS FOR ROWS ALREADY IN THE DATABASE, not a supported shape to write.
 * Any row this service wrote before the nesting fix holds an array and nothing else — the engine's
 * object is already gone from it and cannot be recovered here. Reading it keeps those rows
 * rendering their weather until the engine's next scheduled pass rewrites the row properly.
 */
export function readWeatherFactors(raw: unknown): WeatherAdjustmentFactor[] {
  if (Array.isArray(raw)) return raw as WeatherAdjustmentFactor[]
  if (isPlainObject(raw) && Array.isArray(raw[WEATHER_FACTORS_KEY])) {
    return raw[WEATHER_FACTORS_KEY] as WeatherAdjustmentFactor[]
  }
  return []
}

/**
 * Merge weather factors into the existing blob without disturbing anything else in it.
 *
 * ⚠ A bare array found in `existing` is DISCARDED rather than merged: it is this service's own
 * pre-fix write, it carries no engine data, and preserving it would keep the broken shape alive.
 */
export function mergeWeatherFactors(
  existing: unknown,
  factors: WeatherAdjustmentFactor[],
): Record<string, unknown> {
  const base = isPlainObject(existing) ? { ...existing } : {}
  base[WEATHER_FACTORS_KEY] = factors
  return base
}

function buildSnapshotLookupKey(args: {
  playerId: string
  season: number
  week: number | null | undefined
  eventId: string | null | undefined
}): string {
  const w = args.week != null ? String(args.week) : 'n'
  const e = args.eventId?.trim() ? args.eventId : 'n'
  return `${args.playerId}|${args.season}|${w}|${e}`
}

function mapRowToAf(row: {
  playerId: string
  playerName: string
  sport: string
  position: string
  baselineProjection: number
  weatherAdjustment: number
  afProjection: number
  adjustmentFactors: unknown
  adjustmentReason: string | null
  confidenceLevel: string
  isOutdoorGame: boolean
  computedAt: Date
}): AFProjection {
  const factors = readWeatherFactors(row.adjustmentFactors)
  return {
    playerId: row.playerId,
    playerName: row.playerName,
    sport: row.sport,
    position: row.position,
    baselineProjection: row.baselineProjection,
    weatherAdjustment: row.weatherAdjustment,
    afProjection: row.afProjection,
    adjustmentFactors: factors,
    shortReason: row.adjustmentReason ?? '',
    confidenceLevel: row.confidenceLevel,
    isOutdoorGame: row.isOutdoorGame,
    hasWeatherData: factors.length > 0,
    weatherSnapshot: null,
    computedAt: row.computedAt,
  }
}

async function persistSnapshot(
  lookupKey: string,
  params: {
    playerId: string
    playerName: string
    sport: string
    position: string
    week?: number
    season: number
    eventId?: string
  },
  body: {
    baselineProjection: number
    weatherAdjustment: number
    afProjection: number
    adjustmentFactors: WeatherAdjustmentFactor[]
    adjustmentReason: string | null
    confidenceLevel: string
    isOutdoorGame: boolean
    /**
     * The weather cache key this projection was computed against, or null when no weather was
     * consulted at all.
     *
     * 🛑 THIS IS WHAT MAKES A ZERO ADJUSTMENT HONEST. `weatherAdjustment` of 0 has two completely
     * different meanings — "we looked and it changes nothing" and "nobody has ever looked" — and
     * until now the row could not tell them apart. It mattered because the scheduled engine writes
     * every row with `weatherAdjustment: 0` and no weather layer, while `readAfProjections`
     * documented that same 0 as "considered, no change" and Chimmy read it out to users as
     * "weather was considered and moved it by nothing". That sentence was false for every row.
     *
     * Non-null means a lookup genuinely happened. The column already existed on the model and had
     * no writer, so this needs no migration.
     */
    weatherCacheId: string | null
  },
  computedAt: Date
): Promise<void> {
  try {
    /*
     * Read-modify-write, because Prisma replaces a JSON column wholesale and this row's
     * `adjustmentFactors` belongs to the projection engine. One extra read on an on-demand path is
     * the price of not erasing `idp.componentAmounts`; see WEATHER_FACTORS_KEY above.
     *
     * ⚠ Racy against a concurrent engine pass, and deliberately left so. The loser of that race
     * writes a blob missing one subsystem's branch, which the next pass repairs — where the bug
     * being fixed here destroyed the engine's branch on EVERY weather request, permanently until
     * the next scheduled run.
     */
    const prior = await prisma.aFProjectionSnapshot.findUnique({
      where: { snapshotLookupKey: lookupKey },
      select: { adjustmentFactors: true },
    })
    const mergedFactors = mergeWeatherFactors(
      prior?.adjustmentFactors,
      body.adjustmentFactors,
    ) as unknown as Prisma.InputJsonValue

    await prisma.aFProjectionSnapshot.upsert({
      where: { snapshotLookupKey: lookupKey },
      create: {
        snapshotLookupKey: lookupKey,
        playerId: params.playerId,
        playerName: params.playerName,
        sport: params.sport,
        position: params.position,
        week: params.week ?? null,
        season: params.season,
        eventId: params.eventId ?? null,
        baselineProjection: body.baselineProjection,
        weatherAdjustment: body.weatherAdjustment,
        afProjection: body.afProjection,
        adjustmentFactors: mergedFactors,
        adjustmentReason: body.adjustmentReason,
        confidenceLevel: body.confidenceLevel,
        isOutdoorGame: body.isOutdoorGame,
        weatherCacheId: body.weatherCacheId,
        venueOverride: false,
        computedAt,
      },
      update: {
        playerName: params.playerName,
        sport: params.sport,
        position: params.position,
        baselineProjection: body.baselineProjection,
        weatherAdjustment: body.weatherAdjustment,
        afProjection: body.afProjection,
        adjustmentFactors: mergedFactors,
        adjustmentReason: body.adjustmentReason,
        confidenceLevel: body.confidenceLevel,
        isOutdoorGame: body.isOutdoorGame,
        weatherCacheId: body.weatherCacheId,
        computedAt,
      },
    })
  } catch (e) {
    console.error('[AFProjection] snapshot write failed:', e)
  }
}

function buildAfResult(
  params: {
    playerId: string
    playerName: string
    sport: string
    position: string
    baselineProjection: number
  },
  weather: NormalizedWeather | null,
  impact: ReturnType<typeof calculateWeatherImpact>,
  computedAt: Date
): AFProjection {
  let af = params.baselineProjection + impact.totalAdjustment
  if (af < 0) af = 0
  return {
    playerId: params.playerId,
    playerName: params.playerName,
    sport: params.sport,
    position: params.position,
    baselineProjection: params.baselineProjection,
    weatherAdjustment: impact.totalAdjustment,
    afProjection: af,
    adjustmentFactors: impact.factors,
    shortReason: impact.shortReason,
    confidenceLevel: impact.confidenceLevel,
    isOutdoorGame: impact.isOutdoor,
    hasWeatherData: impact.hasWeatherData,
    weatherSnapshot: weather
      ? {
          temperatureF: weather.temperatureF,
          windSpeedMph: weather.windSpeedMph,
          precipChancePct: weather.precipChancePct,
          conditionLabel: weather.conditionLabel,
        }
      : null,
    computedAt,
  }
}

export async function getAFProjection(
  params: {
    playerId: string
    playerName: string
    sport: string
    position: string
    baselineProjection: number
    gameLocation: { lat: number; lng: number } | null
    gameTime: Date | null
    isIndoor?: boolean
    isDome?: boolean
    roofClosed?: boolean
    week?: number
    season?: number
    eventId?: string
  },
  opts?: { prefetchedWeather?: NormalizedWeather | null }
): Promise<AFProjection> {
  const season = params.season ?? new Date().getFullYear()
  const lookupKey = buildSnapshotLookupKey({
    playerId: params.playerId,
    season,
    week: params.week,
    eventId: params.eventId,
  })

  const now = Date.now()
  try {
    const existing = await prisma.aFProjectionSnapshot.findUnique({
      where: { snapshotLookupKey: lookupKey },
    })
    if (existing && now - existing.computedAt.getTime() < SNAPSHOT_TTL_MS) {
      return mapRowToAf(existing)
    }
  } catch (e) {
    console.error('[AFProjection] snapshot read failed:', e)
  }

  const computedAt = new Date()

  if (
    !isWeatherSensitiveSport(params.sport) ||
    !params.gameLocation ||
    !params.gameTime
  ) {
    const result = buildAfResult(
      params,
      null,
      calculateWeatherImpact(params.sport, params.position, null, params.baselineProjection),
      computedAt
    )
    await persistSnapshot(
      lookupKey,
      {
        playerId: params.playerId,
        playerName: params.playerName,
        sport: params.sport,
        position: params.position,
        week: params.week,
        season,
        eventId: params.eventId,
      },
      {
        baselineProjection: params.baselineProjection,
        weatherAdjustment: 0,
        afProjection: params.baselineProjection,
        adjustmentFactors: [],
        adjustmentReason: null,
        confidenceLevel: 'unavailable',
        isOutdoorGame: true,
        // Nothing was consulted: not a weather-sensitive sport, or no venue/kickoff was supplied.
        weatherCacheId: null,
      },
      computedAt
    )
    return {
      ...result,
      weatherAdjustment: 0,
      afProjection: params.baselineProjection,
      adjustmentFactors: [],
      shortReason: '',
      confidenceLevel: 'unavailable',
      hasWeatherData: false,
    }
  }

  const weather =
    opts?.prefetchedWeather !== undefined
      ? opts.prefetchedWeather
      : await getWeatherForEvent({
          lat: params.gameLocation.lat,
          lng: params.gameLocation.lng,
          gameTime: params.gameTime,
          sport: params.sport,
          eventId: params.eventId,
          isIndoor: params.isIndoor,
          isDome: params.isDome,
          roofClosed: params.roofClosed,
        })

  const impact = calculateWeatherImpact(
    params.sport,
    params.position,
    weather,
    params.baselineProjection
  )
  const result = buildAfResult(params, weather, impact, computedAt)

  await persistSnapshot(
    lookupKey,
    {
      playerId: params.playerId,
      playerName: params.playerName,
      sport: params.sport,
      position: params.position,
      week: params.week,
      season,
      eventId: params.eventId,
    },
    {
      baselineProjection: params.baselineProjection,
      weatherAdjustment: impact.totalAdjustment,
      afProjection: result.afProjection,
      adjustmentFactors: impact.factors,
      adjustmentReason: impact.shortReason,
      confidenceLevel: impact.confidenceLevel,
      isOutdoorGame: impact.isOutdoor,
      /*
       * A lookup happened. `meta.cacheKey` identifies WHICH forecast this number came from, so a
       * disputed projection can be traced to its input rather than argued about. Falls back to the
       * data source when the cache layer supplied no key — still non-null, which is the part every
       * reader keys off.
       */
      weatherCacheId: weather ? weather.meta?.cacheKey ?? weather.dataSource ?? 'weather' : null,
    },
    computedAt
  )

  return result
}

function batchWeatherKey(p: {
  gameLocation: { lat: number; lng: number } | null
  gameTime: Date | null
  isIndoor?: boolean
  isDome?: boolean
  roofClosed?: boolean
}): string | null {
  if (!p.gameLocation || !p.gameTime) return null
  return [
    p.gameLocation.lat.toFixed(2),
    p.gameLocation.lng.toFixed(2),
    p.gameTime.toISOString().slice(0, 13),
    p.isIndoor ? '1' : '0',
    p.isDome ? '1' : '0',
    p.roofClosed ? '1' : '0',
  ].join('|')
}

export async function getAFProjectionBatch(
  players: Array<{
    playerId: string
    playerName: string
    sport: string
    position: string
    baselineProjection: number
    gameLocation: { lat: number; lng: number } | null
    gameTime: Date | null
    isIndoor?: boolean
    isDome?: boolean
    roofClosed?: boolean
    eventId?: string
    week?: number
    season?: number
  }>
): Promise<AFProjection[]> {
  const weatherMemo = new Map<string, NormalizedWeather | null>()

  for (const p of players) {
    const k = batchWeatherKey(p)
    if (!k || weatherMemo.has(k)) continue

    if (!isWeatherSensitiveSport(p.sport) || !p.gameLocation || !p.gameTime) {
      weatherMemo.set(k, null)
      continue
    }

    try {
      const w = await getWeatherForEvent({
        lat: p.gameLocation.lat,
        lng: p.gameLocation.lng,
        gameTime: p.gameTime,
        sport: p.sport,
        eventId: p.eventId,
        isIndoor: p.isIndoor,
        isDome: p.isDome,
        roofClosed: p.roofClosed,
      })
      weatherMemo.set(k, w)
    } catch {
      weatherMemo.set(k, null)
    }
  }

  const out: AFProjection[] = []
  for (const p of players) {
    const k = batchWeatherKey(p)
    const prefetched = k ? weatherMemo.get(k) : undefined
    out.push(
      await getAFProjection(
        p,
        prefetched !== undefined ? { prefetchedWeather: prefetched } : undefined
      )
    )
  }
  return out
}
