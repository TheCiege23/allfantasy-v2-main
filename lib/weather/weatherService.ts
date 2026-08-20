import { prisma } from '@/lib/prisma'
import {
  fetchForecastWeatherAtTime,
  fetchWeatherByCity,
  fetchWeatherByCoords,
  type ForecastWeatherAtTime,
  type GameWeather,
  type WeatherData,
  NFL_TEAM_VENUES,
  NFL_VENUE_COORDS,
} from '@/lib/openweathermap'

type WeatherCacheDelegate = {
  upsert: (args: unknown) => Promise<unknown>
  findUnique: (args: unknown) => Promise<{
    temperatureF: number | null
    feelsLikeF: number | null
    windSpeedMph: number | null
    windGustsMph: number | null
    windDirectionDeg: number | null
    precipChancePct: number | null
    rainInches: number | null
    snowInches: number | null
    humidityPct: number | null
    visibilityMiles: number | null
    conditionCode: string | null
    conditionLabel: string | null
    cloudCoverPct: number | null
    isIndoor: boolean
    isDome: boolean
    roofClosed: boolean
    fetchedAt: Date
    expiresAt: Date
    dataSource: string
    apiResponseRaw?: unknown
  } | null>
}

/** `$extends` + optional schema drift: delegate accessed narrowly for weather cache. */
function weatherCacheDb(): WeatherCacheDelegate {
  return (prisma as unknown as { weatherCache: WeatherCacheDelegate }).weatherCache
}

const MS = 1000
const MIN = 60 * MS
const HOUR = 60 * MIN

export const GAME_WEATHER_TTL_MS = 30 * MIN

/**
 * Must outlive the refresh cadence, or the cache is expired more often than not.
 *
 * /api/weather/refresh-cron runs every 3 hours and only refetches a row when it
 * has expired or is older than 3 hours — but this TTL was 60 minutes, so every
 * team-window row spent two of every three hours expired. Measured in
 * production: 229 rows cached, newest fetched 05:53 the same morning, and ZERO
 * of them unexpired at the time of the check. Consumers that honour expiresAt
 * (the read paths do) therefore saw no weather at all most of the day, which
 * reads as "we have no forecast" rather than "the cache lapsed".
 *
 * Four hours covers the 3-hour cadence plus cron jitter. Raising the TTL rather
 * than running the cron hourly is deliberate: the refresh fetches one call per
 * team-window, so hourly would be ~5.5k provider calls a day against a 1k
 * allowance.
 */
export const TEAM_WINDOW_WEATHER_TTL_MS = 4 * HOUR
export const CITY_WEATHER_TTL_MS = 30 * MIN
export const COORDS_WEATHER_TTL_MS = 30 * MIN
export const STATIC_WEATHER_TTL_MS = 6 * HOUR

export type WeatherCacheMeta = {
  cacheKey: string
  cacheHit: boolean
  degraded: boolean
  stale: boolean
}

export type WeatherDataWithMeta = WeatherData & { meta: WeatherCacheMeta }
export type GameWeatherWithMeta = GameWeather & { meta: WeatherCacheMeta }

export type NormalizedWeather = {
  temperatureF: number
  feelsLikeF: number
  windSpeedMph: number
  windGustsMph: number
  windDirectionDeg: number
  precipChancePct: number
  rainInches: number
  snowInches: number
  humidityPct: number
  visibilityMiles: number
  conditionCode: string
  conditionLabel: string
  cloudCoverPct: number
  isIndoor: boolean
  isDome: boolean
  roofClosed: boolean
  fetchedAt: Date
  expiresAt: Date
  dataSource: string
  cacheHit: boolean
  meta?: WeatherCacheMeta
}

export type WeatherLookupParams = {
  lat: number
  lng: number
  gameTime: Date
  sport?: string
  eventId?: string
  isIndoor?: boolean
  isDome?: boolean
  roofClosed?: boolean
  cacheKey?: string
  ttlMs?: number
  /** Skip DB read and force API fetch */
  forceRefresh?: boolean
}

type WeatherCacheRead = Awaited<ReturnType<WeatherCacheDelegate['findUnique']>>

function normalizeCacheText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildDateBucket(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function coordCachePart(value: number): string {
  return value.toFixed(2)
}

export function buildWeatherGameCacheKey(sport: string, gameId: string): string {
  return `weather:game:${sport.toLowerCase()}:${normalizeCacheText(gameId)}`
}

export function buildWeatherTeamWindowCacheKey(team: string, date: Date): string {
  return `weather:team-window:${team.trim().toUpperCase()}:${buildDateBucket(date)}`
}

export function buildWeatherCityCacheKey(city: string, date: Date): string {
  return `weather:city:${normalizeCacheText(city)}:${buildDateBucket(date)}`
}

export function buildWeatherCoordsCacheKey(lat: number, lng: number, date: Date): string {
  return `weather:coords:${coordCachePart(lat)}:${coordCachePart(lng)}:${buildDateBucket(date)}`
}

function buildWeatherMeta(cacheKey: string, options?: Partial<Omit<WeatherCacheMeta, 'cacheKey'>>): WeatherCacheMeta {
  return {
    cacheKey,
    cacheHit: options?.cacheHit ?? false,
    degraded: options?.degraded ?? false,
    stale: options?.stale ?? false,
  }
}

function weatherLog(message: string, details: Record<string, unknown>): void {
  console.info(`[weather] ${message}`, details)
}

function weatherWarn(message: string, details: Record<string, unknown>): void {
  console.warn(`[weather] ${message}`, details)
}

function metersToMiles(m: number): number {
  return m / 1609.344
}

function computeExpiresAt(gameTime: Date, fetchedAt: Date, ttlMs?: number): Date {
  if (typeof ttlMs === 'number' && ttlMs > 0) {
    return new Date(fetchedAt.getTime() + ttlMs)
  }
  const hoursUntil = (gameTime.getTime() - fetchedAt.getTime()) / HOUR
  if (hoursUntil < 0) {
    return new Date(fetchedAt.getTime() + 10 * 365 * 24 * HOUR)
  }
  if (hoursUntil > 7 * 24) {
    return new Date(fetchedAt.getTime() + 6 * HOUR)
  }
  if (hoursUntil >= 48) {
    return new Date(fetchedAt.getTime() + 3 * HOUR)
  }
  if (hoursUntil >= 6) {
    return new Date(fetchedAt.getTime() + 30 * MIN)
  }
  return new Date(fetchedAt.getTime() + 10 * MIN)
}

function buildCacheKey(lat: number, lng: number, gameTime: Date): string {
  return buildWeatherCoordsCacheKey(lat, lng, gameTime)
}

function forecastToNormalized(
  f: ForecastWeatherAtTime,
  fetchedAt: Date,
  expiresAt: Date,
  ctx: {
    isIndoor: boolean
    isDome: boolean
    roofClosed: boolean
    cacheHit: boolean
  }
): NormalizedWeather {
  return {
    temperatureF: f.temp,
    feelsLikeF: f.feelsLike,
    windSpeedMph: f.windSpeed,
    windGustsMph: f.windGust ?? 0,
    windDirectionDeg: f.windDeg,
    precipChancePct: f.pop * 100,
    rainInches: f.rainInches3h,
    snowInches: f.snowInches3h,
    humidityPct: f.humidity,
    visibilityMiles: metersToMiles(f.visibilityMeters),
    conditionCode: f.conditionCode,
    conditionLabel: f.description || f.conditionMain,
    cloudCoverPct: f.clouds,
    isIndoor: ctx.isIndoor,
    isDome: ctx.isDome,
    roofClosed: ctx.roofClosed,
    fetchedAt,
    expiresAt,
    dataSource: 'openweathermap',
    cacheHit: ctx.cacheHit,
    meta: undefined,
  }
}

function indoorNormalized(params: WeatherLookupParams, fetchedAt: Date): NormalizedWeather {
  const far = new Date(fetchedAt.getTime() + 10 * 365 * 24 * HOUR)
  return {
    temperatureF: 72,
    feelsLikeF: 72,
    windSpeedMph: 0,
    windGustsMph: 0,
    windDirectionDeg: 0,
    precipChancePct: 0,
    rainInches: 0,
    snowInches: 0,
    humidityPct: 50,
    visibilityMiles: 10,
    conditionCode: 'indoor',
    conditionLabel: 'Indoor / climate controlled',
    cloudCoverPct: 0,
    isIndoor: true,
    isDome: Boolean(params.isDome),
    roofClosed: Boolean(params.roofClosed),
    fetchedAt,
    expiresAt: far,
    dataSource: 'none',
    cacheHit: false,
    meta: undefined,
  }
}

function currentWeatherToNormalized(
  weather: WeatherData,
  fetchedAt: Date,
  expiresAt: Date,
  ctx: {
    isIndoor: boolean
    isDome: boolean
    roofClosed: boolean
    cacheHit: boolean
  }
): NormalizedWeather {
  return {
    temperatureF: weather.temp,
    feelsLikeF: weather.feelsLike,
    windSpeedMph: weather.windSpeed,
    windGustsMph: weather.windGust ?? 0,
    windDirectionDeg: weather.windDeg,
    precipChancePct: 0,
    rainInches: weather.rain1h ? weather.rain1h * 0.0393701 : 0,
    snowInches: weather.snow1h ? weather.snow1h * 0.0393701 : 0,
    humidityPct: weather.humidity,
    visibilityMiles: metersToMiles(weather.visibility),
    conditionCode: weather.icon,
    conditionLabel: weather.description || weather.condition,
    cloudCoverPct: weather.clouds,
    isIndoor: ctx.isIndoor,
    isDome: ctx.isDome,
    roofClosed: ctx.roofClosed,
    fetchedAt,
    expiresAt,
    dataSource: 'openweathermap',
    cacheHit: ctx.cacheHit,
    meta: undefined,
  }
}

async function persistWeatherCache(args: {
  cacheKey: string
  lat: number
  lng: number
  forecastForTime: Date
  expiresAt: Date
  normalized: NormalizedWeather
  sport?: string
  eventId?: string
  raw?: unknown
}): Promise<void> {
  const n = args.normalized
  await weatherCacheDb().upsert({
    where: { cacheKey: args.cacheKey },
    create: {
      cacheKey: args.cacheKey,
      latitude: args.lat,
      longitude: args.lng,
      forecastForTime: args.forecastForTime,
      fetchedAt: n.fetchedAt,
      expiresAt: args.expiresAt,
      temperatureF: n.temperatureF,
      feelsLikeF: n.feelsLikeF,
      windSpeedMph: n.windSpeedMph,
      windGustsMph: n.windGustsMph,
      windDirectionDeg: n.windDirectionDeg,
      precipChancePct: n.precipChancePct,
      rainInches: n.rainInches,
      snowInches: n.snowInches,
      humidityPct: n.humidityPct,
      visibilityMiles: n.visibilityMiles,
      conditionCode: n.conditionCode,
      conditionLabel: n.conditionLabel,
      cloudCoverPct: n.cloudCoverPct,
      isIndoor: n.isIndoor,
      isDome: n.isDome,
      roofClosed: n.roofClosed,
      sport: args.sport ?? null,
      eventId: args.eventId ?? null,
      dataSource: n.dataSource,
      apiResponseRaw: args.raw ? (args.raw as object) : undefined,
    },
    update: {
      forecastForTime: args.forecastForTime,
      fetchedAt: n.fetchedAt,
      expiresAt: args.expiresAt,
      temperatureF: n.temperatureF,
      feelsLikeF: n.feelsLikeF,
      windSpeedMph: n.windSpeedMph,
      windGustsMph: n.windGustsMph,
      windDirectionDeg: n.windDirectionDeg,
      precipChancePct: n.precipChancePct,
      rainInches: n.rainInches,
      snowInches: n.snowInches,
      humidityPct: n.humidityPct,
      visibilityMiles: n.visibilityMiles,
      conditionCode: n.conditionCode,
      conditionLabel: n.conditionLabel,
      cloudCoverPct: n.cloudCoverPct,
      isIndoor: n.isIndoor,
      isDome: n.isDome,
      roofClosed: n.roofClosed,
      sport: args.sport ?? null,
      eventId: args.eventId ?? null,
      dataSource: n.dataSource,
      apiResponseRaw: args.raw ? (args.raw as object) : undefined,
    },
  })
}

function rowToNormalized(row: {
  temperatureF: number | null
  feelsLikeF: number | null
  windSpeedMph: number | null
  windGustsMph: number | null
  windDirectionDeg: number | null
  precipChancePct: number | null
  rainInches: number | null
  snowInches: number | null
  humidityPct: number | null
  visibilityMiles: number | null
  conditionCode: string | null
  conditionLabel: string | null
  cloudCoverPct: number | null
  isIndoor: boolean
  isDome: boolean
  roofClosed: boolean
  fetchedAt: Date
  expiresAt: Date
  dataSource: string
}, meta?: WeatherCacheMeta): NormalizedWeather {
  return {
    temperatureF: row.temperatureF ?? 0,
    feelsLikeF: row.feelsLikeF ?? 0,
    windSpeedMph: row.windSpeedMph ?? 0,
    windGustsMph: row.windGustsMph ?? 0,
    windDirectionDeg: row.windDirectionDeg ?? 0,
    precipChancePct: row.precipChancePct ?? 0,
    rainInches: row.rainInches ?? 0,
    snowInches: row.snowInches ?? 0,
    humidityPct: row.humidityPct ?? 0,
    visibilityMiles: row.visibilityMiles ?? 0,
    conditionCode: row.conditionCode ?? '',
    conditionLabel: row.conditionLabel ?? '',
    cloudCoverPct: row.cloudCoverPct ?? 0,
    isIndoor: row.isIndoor,
    isDome: row.isDome,
    roofClosed: row.roofClosed,
    fetchedAt: row.fetchedAt,
    expiresAt: row.expiresAt,
    dataSource: row.dataSource,
    cacheHit: true,
    meta,
  }
}

function rowToWeatherData(row: NonNullable<WeatherCacheRead>, fallbackCity: string): WeatherData {
  const raw = row.apiResponseRaw
  if (raw && typeof raw === 'object') {
    return raw as WeatherData
  }

  return {
    city: fallbackCity,
    temp: row.temperatureF ?? 0,
    feelsLike: row.feelsLikeF ?? row.temperatureF ?? 0,
    tempMin: row.temperatureF ?? 0,
    tempMax: row.temperatureF ?? 0,
    humidity: row.humidityPct ?? 0,
    pressure: 0,
    windSpeed: row.windSpeedMph ?? 0,
    windGust: row.windGustsMph ?? null,
    windDeg: row.windDirectionDeg ?? 0,
    description: row.conditionLabel ?? '',
    icon: row.conditionCode ?? '',
    iconUrl: row.conditionCode
      ? `https://openweathermap.org/img/wn/${row.conditionCode}@2x.png`
      : '',
    visibility: Math.round((row.visibilityMiles ?? 0) * 1609.344),
    clouds: row.cloudCoverPct ?? 0,
    rain1h: row.rainInches ? row.rainInches / 0.0393701 : null,
    snow1h: row.snowInches ? row.snowInches / 0.0393701 : null,
    condition: row.conditionLabel ?? row.conditionCode ?? 'Clear',
    fantasyImpact: row.conditionLabel ?? 'Weather conditions cached',
    fantasyImpactLevel: 'low',
  }
}

async function readCachedWeather(cacheKey: string): Promise<WeatherCacheRead> {
  try {
    return await weatherCacheDb().findUnique({ where: { cacheKey } })
  } catch (error) {
    console.error('[weather] cache read failed:', error)
    return null
  }
}

export async function getWeatherForEvent(params: WeatherLookupParams): Promise<NormalizedWeather | null> {
  const { lat, lng, gameTime } = params
  if (params.isIndoor || params.isDome || params.roofClosed) {
    return indoorNormalized(params, new Date())
  }

  const cacheKey = params.cacheKey ?? (params.eventId && params.sport
    ? buildWeatherGameCacheKey(params.sport, params.eventId)
    : buildCacheKey(lat, lng, gameTime))
  const now = new Date()
  const cached = await readCachedWeather(cacheKey)

  if (!params.forceRefresh && cached && cached.expiresAt > now) {
    weatherLog('Weather cache hit', { cacheKey })
    return rowToNormalized(cached, buildWeatherMeta(cacheKey, { cacheHit: true }))
  }

  weatherLog('Weather cache miss', { cacheKey })

  try {
    const fetchedAt = new Date()
    const liveStart = Date.now()
    const forecast = await fetchForecastWeatherAtTime(lat, lng, gameTime)
    weatherLog(`live refresh durationMs=${Date.now() - liveStart}`, { cacheKey })
    if (!forecast) {
      if (cached) {
        weatherWarn('stale fallback', { cacheKey })
        return rowToNormalized(
          cached,
          buildWeatherMeta(cacheKey, { cacheHit: true, degraded: true, stale: true }),
        )
      }
      return null
    }

    const expiresAt = computeExpiresAt(gameTime, fetchedAt, params.ttlMs)
    const normalized = forecastToNormalized(forecast, fetchedAt, expiresAt, {
      isIndoor: false,
      isDome: false,
      roofClosed: false,
      cacheHit: false,
    })

    try {
      await persistWeatherCache({
        cacheKey,
        lat,
        lng,
        forecastForTime: gameTime,
        expiresAt,
        normalized,
        sport: params.sport,
        eventId: params.eventId,
      })
      weatherLog('cache save', { cacheKey })
    } catch (e) {
      console.error('[WeatherService] cache write failed:', e)
    }

    return normalized
  } catch (error) {
    if (cached) {
      weatherWarn('stale fallback', { cacheKey })
      return rowToNormalized(
        cached,
        buildWeatherMeta(cacheKey, { cacheHit: true, degraded: true, stale: true }),
      )
    }
    console.error('[WeatherService] getWeatherForEvent failed:', error)
    return null
  }
}

export async function getCachedWeatherByCoords(args: {
  lat: number
  lng: number
  referenceDate?: Date
  ttlMs?: number
  cacheKey?: string
  city?: string
}): Promise<{ weather: WeatherData | null; meta: WeatherCacheMeta }> {
  const referenceDate = args.referenceDate ?? new Date()
  const cacheKey = args.cacheKey ?? buildWeatherCoordsCacheKey(args.lat, args.lng, referenceDate)
  const ttlMs = args.ttlMs ?? COORDS_WEATHER_TTL_MS
  const now = new Date()
  const cached = await readCachedWeather(cacheKey)

  if (cached && cached.expiresAt > now) {
    weatherLog('Weather cache hit', { cacheKey })
    return {
      weather: rowToWeatherData(cached, args.city ?? ''),
      meta: buildWeatherMeta(cacheKey, { cacheHit: true }),
    }
  }

  weatherLog('Weather cache miss', { cacheKey })

  try {
    const liveStart = Date.now()
    const weather = await fetchWeatherByCoords(args.lat, args.lng)
    weatherLog(`live refresh durationMs=${Date.now() - liveStart}`, { cacheKey })
    if (!weather) {
      if (cached) {
        weatherWarn('stale fallback', { cacheKey })
        return {
          weather: rowToWeatherData(cached, args.city ?? ''),
          meta: buildWeatherMeta(cacheKey, { cacheHit: true, degraded: true, stale: true }),
        }
      }
      return { weather: null, meta: buildWeatherMeta(cacheKey) }
    }

    const fetchedAt = new Date()
    const expiresAt = computeExpiresAt(referenceDate, fetchedAt, ttlMs)
    try {
      await persistWeatherCache({
        cacheKey,
        lat: args.lat,
        lng: args.lng,
        forecastForTime: referenceDate,
        expiresAt,
        normalized: currentWeatherToNormalized(weather, fetchedAt, expiresAt, {
          isIndoor: false,
          isDome: false,
          roofClosed: false,
          cacheHit: false,
        }),
        raw: weather,
      })
      weatherLog('cache save', { cacheKey })
    } catch (error) {
      console.error('[weather] cache write failed:', error)
    }

    return { weather, meta: buildWeatherMeta(cacheKey) }
  } catch (error) {
    if (cached) {
      weatherWarn('stale fallback', { cacheKey })
      return {
        weather: rowToWeatherData(cached, args.city ?? ''),
        meta: buildWeatherMeta(cacheKey, { cacheHit: true, degraded: true, stale: true }),
      }
    }
    console.error('[weather] current weather fetch failed:', error)
    return { weather: null, meta: buildWeatherMeta(cacheKey) }
  }
}

export async function getCachedWeatherByCity(args: {
  city: string
  referenceDate?: Date
  ttlMs?: number
}): Promise<{ weather: WeatherData | null; meta: WeatherCacheMeta }> {
  const referenceDate = args.referenceDate ?? new Date()
  const cacheKey = buildWeatherCityCacheKey(args.city, referenceDate)
  const cached = await readCachedWeather(cacheKey)
  const now = new Date()

  if (cached && cached.expiresAt > now) {
    weatherLog('Weather cache hit', { cacheKey })
    return {
      weather: rowToWeatherData(cached, args.city),
      meta: buildWeatherMeta(cacheKey, { cacheHit: true }),
    }
  }

  weatherLog('Weather cache miss', { cacheKey })

  try {
    const liveStart = Date.now()
    const weather = await fetchWeatherByCity(args.city)
    weatherLog(`live refresh durationMs=${Date.now() - liveStart}`, { cacheKey })
    if (!weather) {
      if (cached) {
        weatherWarn('stale fallback', { cacheKey })
        return {
          weather: rowToWeatherData(cached, args.city),
          meta: buildWeatherMeta(cacheKey, { cacheHit: true, degraded: true, stale: true }),
        }
      }
      return { weather: null, meta: buildWeatherMeta(cacheKey) }
    }

    const fetchedAt = new Date()
    const expiresAt = computeExpiresAt(referenceDate, fetchedAt, args.ttlMs ?? CITY_WEATHER_TTL_MS)

    try {
      await persistWeatherCache({
        cacheKey,
        lat: 0,
        lng: 0,
        forecastForTime: referenceDate,
        expiresAt,
        normalized: currentWeatherToNormalized(weather, fetchedAt, expiresAt, {
          isIndoor: false,
          isDome: false,
          roofClosed: false,
          cacheHit: false,
        }),
        raw: weather,
      })
      weatherLog('cache save', { cacheKey })
    } catch (error) {
      console.error('[weather] cache write failed:', error)
    }

    return { weather, meta: buildWeatherMeta(cacheKey) }
  } catch (error) {
    if (cached) {
      weatherWarn('stale fallback', { cacheKey })
      return {
        weather: rowToWeatherData(cached, args.city),
        meta: buildWeatherMeta(cacheKey, { cacheHit: true, degraded: true, stale: true }),
      }
    }
    console.error('[weather] city weather fetch failed:', error)
    return { weather: null, meta: buildWeatherMeta(cacheKey) }
  }
}

export async function getCachedGameWeather(args: {
  sport?: string
  homeTeam: string
  gameId?: string
  referenceDate?: Date
  ttlMs?: number
}): Promise<GameWeatherWithMeta | null> {
  const sport = (args.sport ?? 'NFL').toUpperCase()
  const normalizedTeam = args.homeTeam.trim().toUpperCase()
  const cacheKey = buildWeatherGameCacheKey(sport, args.gameId ?? normalizedTeam)
  const venueName = NFL_TEAM_VENUES[normalizedTeam]
  if (!venueName) return null

  const venueData = NFL_VENUE_COORDS[venueName]
  if (!venueData) return null

  if (venueData.dome) {
    return {
      venue: venueName,
      homeTeam: normalizedTeam,
      awayTeam: '',
      weather: {
        city: venueName,
        temp: 72,
        feelsLike: 72,
        tempMin: 72,
        tempMax: 72,
        humidity: 50,
        pressure: 1013,
        windSpeed: 0,
        windGust: null,
        windDeg: 0,
        description: 'Indoor stadium — climate controlled',
        icon: '01d',
        iconUrl: 'https://openweathermap.org/img/wn/01d@2x.png',
        visibility: 10000,
        clouds: 0,
        rain1h: null,
        snow1h: null,
        condition: 'Dome',
        fantasyImpact: 'Indoor stadium — no weather impact',
        fantasyImpactLevel: 'none',
      },
      gameTime: (args.referenceDate ?? new Date()).toISOString(),
      isDome: true,
      meta: buildWeatherMeta(cacheKey, { cacheHit: true }),
    }
  }

  const current = await getCachedWeatherByCoords({
    lat: venueData.lat,
    lng: venueData.lon,
    referenceDate: args.referenceDate,
    ttlMs: args.ttlMs ?? GAME_WEATHER_TTL_MS,
    cacheKey,
    city: venueName,
  })

  if (!current.weather) return null

  return {
    venue: venueName,
    homeTeam: normalizedTeam,
    awayTeam: '',
    weather: current.weather,
    gameTime: (args.referenceDate ?? new Date()).toISOString(),
    isDome: false,
    meta: current.meta,
  }
}

/** MLB parks with retractable roof / dome flag for venue-aware checks */
export const MLB_VENUE_COORDS: Record<string, { lat: number; lng: number; dome: boolean }> = {
  'Tropicana Field': { lat: 27.7682, lng: -82.6534, dome: true },
  'Minute Maid Park': { lat: 29.7573, lng: -95.3555, dome: true },
  'Globe Life Field': { lat: 32.7473, lng: -97.0819, dome: true },
  'loanDepot park': { lat: 25.7781, lng: -80.2197, dome: true },
  'American Family Field': { lat: 43.028, lng: -87.9712, dome: true },
  'Chase Field': { lat: 33.4453, lng: -112.0667, dome: true },
  'Rogers Centre': { lat: 43.6414, lng: -79.3894, dome: true },
}

export const GOLF_VENUE_COORDS: Record<string, { lat: number; lng: number }> = {
  'Augusta National': { lat: 33.503, lng: -82.0199 },
  'Pebble Beach': { lat: 36.5681, lng: -121.9505 },
  'TPC Sawgrass': { lat: 30.1984, lng: -81.394 },
  'Torrey Pines': { lat: 32.9047, lng: -117.2453 },
  'Oak Hill': { lat: 43.1152, lng: -77.525 },
  'Valhalla': { lat: 38.2542, lng: -85.5025 },
}

export const NASCAR_TRACK_COORDS: Record<string, { lat: number; lng: number }> = {
  Daytona: { lat: 29.1851, lng: -81.0705 },
  Talladega: { lat: 33.4335, lng: -86.3142 },
  Charlotte: { lat: 35.3517, lng: -80.6814 },
}

export const TENNIS_VENUE_COORDS: Record<string, { lat: number; lng: number; outdoor: boolean }> = {
  'Indian Wells': { lat: 33.7243, lng: -116.3033, outdoor: true },
  'Miami Open': { lat: 25.768, lng: -80.14, outdoor: true },
  Wimbledon: { lat: 51.4347, lng: -0.2147, outdoor: true },
}

const VENUE_TABLES: Array<Record<string, { lat: number; lng: number; dome?: boolean; outdoor?: boolean }>> = [
  Object.fromEntries(
    Object.entries(NFL_VENUE_COORDS).map(([k, v]) => [k, { lat: v.lat, lng: v.lon, dome: v.dome }])
  ),
  MLB_VENUE_COORDS,
  GOLF_VENUE_COORDS,
  NASCAR_TRACK_COORDS,
  Object.fromEntries(
    Object.entries(TENNIS_VENUE_COORDS).map(([k, v]) => [k, { lat: v.lat, lng: v.lng, outdoor: v.outdoor }])
  ),
]

function matchVenueTable(address: string): { lat: number; lng: number; isDome?: boolean } | null {
  const a = address.trim().toLowerCase()
  for (const table of VENUE_TABLES) {
    for (const [name, row] of Object.entries(table)) {
      if (a.includes(name.toLowerCase()) || name.toLowerCase().includes(a)) {
        return { lat: row.lat, lng: row.lng, isDome: 'dome' in row ? row.dome : undefined }
      }
    }
  }
  return null
}

async function geocodeOpenWeather(address: string): Promise<{ lat: number; lng: number } | null> {
  const apiKey = process.env.OPENWEATHERMAP_API_KEY
  if (!apiKey) return null
  try {
    const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(address)}&limit=1&appid=${apiKey}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as Array<{ lat: number; lon: number }>
    if (!data?.length) return null
    return { lat: data[0]!.lat, lng: data[0]!.lon }
  } catch {
    return null
  }
}

export async function getWeatherForEventByAddress(
  address: string,
  gameTime: Date,
  params?: Partial<WeatherLookupParams>
): Promise<NormalizedWeather | null> {
  const fromTable = matchVenueTable(address)
  const coords = fromTable ?? (await geocodeOpenWeather(address))
  if (!coords) return null

  return getWeatherForEvent({
    lat: coords.lat,
    lng: coords.lng,
    gameTime,
    sport: params?.sport,
    eventId: params?.eventId,
    isIndoor: params?.isIndoor,
    isDome: params?.isDome ?? fromTable?.isDome,
    roofClosed: params?.roofClosed,
    forceRefresh: params?.forceRefresh,
  })
}
