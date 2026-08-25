import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveVenueForTeam } from '@/lib/weather/venueResolver'
import { buildWeatherCoordsCacheKey } from '@/lib/weather/weatherService'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

/**
 * Weather for each player's game, read from cache only.
 *
 * ⚠ NEVER FETCHES. This runs on a request path, and the provider boundary guard
 * exists precisely to stop a roster render turning into a fan-out of forecast
 * calls. The refresh cron populates `WeatherCache` for games inside seven days;
 * anything further out simply has no row yet, and "no forecast yet" is the
 * honest thing to show for a game two weeks away.
 *
 * ⚠ THE DOME ANSWER NEEDS NO FORECAST AT ALL. A roofed stadium is a property of
 * the venue, so it resolves from the home team without touching the cache —
 * which matters because most rows have no cached forecast, and "indoors" is
 * true regardless.
 *
 * ⚠ RESOLVED FROM THE HOME TEAM, NOT `SportsGame.venue`. That column is null on
 * exactly the rows that carry a season type, so reading it would return nothing
 * for most games.
 */

export type GameWeather = {
  indoors: boolean
  /** Null when no forecast is cached for this kickoff. */
  temperatureF: number | null
  windSpeedMph: number | null
  precipChancePct: number | null
  conditionLabel: string | null
  /** A single glyph for the row: dome, sun, cloud, rain, snow, wind. */
  symbol: string
}

/** Retractable roofs are recorded as domes; nothing tracks whether one is shut. */
function domeWeather(): GameWeather {
  return {
    indoors: true,
    temperatureF: null,
    windSpeedMph: null,
    precipChancePct: null,
    conditionLabel: 'Indoors',
    symbol: '⌂',
  }
}

/**
 * One glyph for the row.
 *
 * Ordered by what changes a lineup decision: snow beats rain beats wind beats
 * cloud. A manager benching someone for weather is reacting to the worst thing
 * happening, not the average of it.
 */
function symbolFor(w: {
  snowInches: number | null
  precipChancePct: number | null
  windSpeedMph: number | null
  temperatureF: number | null
  cloudCoverPct: number | null
}): string {
  if ((w.snowInches ?? 0) > 0 || (w.temperatureF != null && w.temperatureF <= 25)) return '❄'
  if ((w.precipChancePct ?? 0) >= 50) return '☔'
  if ((w.windSpeedMph ?? 0) >= 15) return '💨'
  if ((w.cloudCoverPct ?? 0) >= 60) return '☁'
  return '☀'
}

export async function getGameWeather(args: {
  sport: string
  /** playerKey -> { team, kickoff } for the HOST team of that player's game. */
  games: Map<string, { hostTeam: string | null; kickoff: Date | null }>
}): Promise<Map<string, GameWeather>> {
  const out = new Map<string, GameWeather>()
  if (args.games.size === 0) return out

  /** cacheKey -> the player keys waiting on it. */
  const waiting = new Map<string, string[]>()

  for (const [playerKey, g] of args.games) {
    const abbrev = normalizeTeamAbbrev(g.hostTeam)
    if (!abbrev) continue
    const venue = resolveVenueForTeam({ sport: args.sport as 'NFL', teamAbbrev: abbrev })
    if (venue.kind !== 'coords') continue

    if (venue.dome) {
      out.set(playerKey, domeWeather())
      continue
    }
    if (!g.kickoff) continue

    const key = buildWeatherCoordsCacheKey(venue.lat, venue.lng, g.kickoff)
    const list = waiting.get(key) ?? []
    list.push(playerKey)
    waiting.set(key, list)
  }

  if (waiting.size === 0) return out

  const rows = await prisma.weatherCache
    .findMany({
      where: { cacheKey: { in: [...waiting.keys()] } },
      select: {
        cacheKey: true,
        temperatureF: true,
        windSpeedMph: true,
        precipChancePct: true,
        snowInches: true,
        cloudCoverPct: true,
        conditionLabel: true,
        isDome: true,
        isIndoor: true,
      },
    })
    .catch(() => [])

  for (const r of rows) {
    const indoors = Boolean(r.isDome || r.isIndoor)
    const w: GameWeather = indoors
      ? domeWeather()
      : {
          indoors: false,
          temperatureF: r.temperatureF ?? null,
          windSpeedMph: r.windSpeedMph ?? null,
          precipChancePct: r.precipChancePct ?? null,
          conditionLabel: r.conditionLabel ?? null,
          symbol: symbolFor({
            snowInches: r.snowInches ?? null,
            precipChancePct: r.precipChancePct ?? null,
            windSpeedMph: r.windSpeedMph ?? null,
            temperatureF: r.temperatureF ?? null,
            cloudCoverPct: r.cloudCoverPct ?? null,
          }),
        }
    for (const playerKey of waiting.get(r.cacheKey) ?? []) out.set(playerKey, w)
  }

  /*
   * Outdoor games with no cached forecast are deliberately left out of the map
   * rather than filled with an "unknown" object. The caller already renders an
   * open-air mark from the venue alone; inventing a blank forecast next to it
   * would suggest we looked and found nothing, when we simply have not looked
   * that far ahead yet.
   */
  return out
}
