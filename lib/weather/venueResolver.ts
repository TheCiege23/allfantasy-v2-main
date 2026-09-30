import { NFL_TEAM_VENUES, NFL_VENUE_COORDS } from '@/lib/openweathermap'
import type { SupportedSport } from '@/lib/sport-scope'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { MLB_TEAM_BALLPARK } from '@/lib/weather/mlbTeamBallparks'
import { NCAAF_TEAM_STADIUM } from '@/lib/weather/ncaafTeamStadiums'
import { SOCCER_TEAM_GEOCODE_QUERY } from '@/lib/weather/soccerTeamGeocode'
import {
  TEAM_WINDOW_WEATHER_TTL_MS,
  buildWeatherTeamWindowCacheKey,
  getWeatherForEvent,
  getWeatherForEventByAddress,
} from '@/lib/weather/weatherService'

export type ResolvedVenue =
  | {
      kind: 'coords'
      lat: number
      lng: number
      dome: boolean
      label: string
    }
  | { kind: 'none' }

function normAbbrev(raw: string | null | undefined): string | null {
  if (!raw) return null
  const u = raw.trim().toUpperCase()
  if (u.length <= 4) return u
  return u.slice(0, 4)
}

/**
 * Resolve home venue coordinates for forecast fetches. Away-game nuance: forecast is at **listed team home venue**
 * unless schedule integration supplies game site (future).
 */
export function resolveVenueForTeam(args: { sport: SupportedSport; teamAbbrev: string | null | undefined }): ResolvedVenue {
  const abbrev = normAbbrev(args.teamAbbrev)
  if (!abbrev) return { kind: 'none' }

  if (args.sport === 'NFL') {
    /*
     * ⚠ `normAbbrev` slices to 4 characters, so a full name ("Cleveland Browns" → "CLEV") matched
     * nothing here and every caller that passed one — the weather cron's no-venue fallback,
     * chat enrichment — silently got `none`. Fold NFL through the canonical alias map first, so
     * every spelling a feed sends lands on the same stadium and the same cache key.
     */
    const nflAbbrev = normalizeTeamAbbrev(args.teamAbbrev) ?? abbrev
    const venueName = NFL_TEAM_VENUES[nflAbbrev]
    if (!venueName) return { kind: 'none' }
    const row = NFL_VENUE_COORDS[venueName]
    if (!row) return { kind: 'none' }
    return {
      kind: 'coords',
      lat: row.lat,
      lng: row.lon,
      dome: row.dome,
      label: venueName,
    }
  }

  if (args.sport === 'MLB') {
    const row = MLB_TEAM_BALLPARK[abbrev]
    if (!row) return { kind: 'none' }
    return { kind: 'coords', lat: row.lat, lng: row.lng, dome: row.dome, label: row.label }
  }

  if (args.sport === 'NCAAF') {
    const row = NCAAF_TEAM_STADIUM[abbrev]
    if (!row) return { kind: 'none' }
    return { kind: 'coords', lat: row.lat, lng: row.lng, dome: row.dome, label: row.label }
  }

  return { kind: 'none' }
}

/** Soccer: city-level geocode query for OpenWeather. */
export function resolveSoccerGeocodeQuery(teamAbbrev: string | null | undefined): string | null {
  const a = normAbbrev(teamAbbrev)
  if (!a) return null
  return SOCCER_TEAM_GEOCODE_QUERY[a] ?? null
}

/**
 * Fetch normalized weather at venue or geocoded city for soccer.
 */
export async function fetchWeatherForTeamHomeWindow(args: {
  sport: SupportedSport
  teamAbbrev: string | null | undefined
  gameTime: Date
}): Promise<import('@/lib/weather/weatherService').NormalizedWeather | null> {
  const teamKey = normAbbrev(args.teamAbbrev) ?? 'unknown'
  const cacheKey = buildWeatherTeamWindowCacheKey(teamKey, args.gameTime)

  if (args.sport === 'SOCCER') {
    const q = resolveSoccerGeocodeQuery(args.teamAbbrev)
    if (!q) return null
    return getWeatherForEventByAddress(q, args.gameTime, {
      sport: 'SOCCER',
      cacheKey,
      ttlMs: TEAM_WINDOW_WEATHER_TTL_MS,
    })
  }

  const v = resolveVenueForTeam({ sport: args.sport, teamAbbrev: args.teamAbbrev })
  if (v.kind === 'none') return null
  if (v.dome) {
    return getWeatherForEvent({
      lat: v.lat,
      lng: v.lng,
      gameTime: args.gameTime,
      sport: args.sport,
      isDome: true,
      isIndoor: true,
      cacheKey,
      ttlMs: TEAM_WINDOW_WEATHER_TTL_MS,
    })
  }
  return getWeatherForEvent({
    lat: v.lat,
    lng: v.lng,
    gameTime: args.gameTime,
    sport: args.sport,
    cacheKey,
    ttlMs: TEAM_WINDOW_WEATHER_TTL_MS,
  })
}
