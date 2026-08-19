import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server';
import {
  getVenueForTeam,
  isTeamDome,
} from '@/lib/openweathermap';
import { resolveNflRedraftCanonicalWeather } from '@/lib/nfl-provider/nflRedraftProviderCertification';
import {
  getCachedGameWeather,
  getCachedWeatherByCity,
  getCachedWeatherByCoords,
  getWeatherForEvent,
} from '@/lib/weather/weatherService';
import { normalizeTeamAbbrev } from '@/lib/team-abbrev';

export const dynamic = 'force-dynamic';

export const GET = withApiUsage({ endpoint: "/api/sports/weather", tool: "SportsWeather" })(async (request: NextRequest) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const team = searchParams?.get('team');
    const city = searchParams?.get('city');
    const lat = searchParams?.get('lat');
    const lon = searchParams?.get('lon');
    const gameTime = searchParams?.get('gameTime');
    const forecast = searchParams?.get('forecast');

    if (lat && lon && gameTime && (forecast === '1' || forecast === 'true')) {
      const normalized = await getWeatherForEvent({
        lat: parseFloat(lat),
        lng: parseFloat(lon),
        gameTime: new Date(gameTime),
        sport: searchParams?.get('sport') ?? undefined,
        eventId: searchParams?.get('eventId') ?? undefined,
        isIndoor: searchParams?.get('isIndoor') === '1' || searchParams?.get('isIndoor') === 'true',
        isDome: searchParams?.get('isDome') === '1' || searchParams?.get('isDome') === 'true',
        roofClosed: searchParams?.get('roofClosed') === '1' || searchParams?.get('roofClosed') === 'true',
      });
      return NextResponse.json({
        normalized,
        source: normalized?.cacheHit ? 'weather-cache' : 'openweathermap-forecast',
        meta: normalized?.meta ?? null,
      });
    }

    if (team) {
      const normalized = normalizeTeamAbbrev(team) || team.toUpperCase();
      const venue = getVenueForTeam(normalized);

      if (!venue) {
        return NextResponse.json(
          { error: `Unknown team: ${team}` },
          { status: 400 }
        );
      }

      const isDome = isTeamDome(normalized);
      const canonical = await resolveNflRedraftCanonicalWeather({ team: normalized });
      const weather = canonical.weather
        ? {
            condition: canonical.weather.condition ?? null,
            temp: canonical.weather.temperatureF ?? null,
            windSpeed: canonical.weather.windSpeedMph ?? null,
            precipitationType: canonical.weather.precipitationType ?? null,
            unavailable: canonical.weather.unavailable === true,
          }
        : null;

      return NextResponse.json({
        team: normalized,
        venue: typeof canonical.venue?.name === 'string' ? canonical.venue.name : venue,
        isDome,
        weather,
        meta: {
          canonical: true,
          provider: canonical.source,
          freshnessStatus: canonical.freshnessStatus,
          fallbackUsed: canonical.fallbackUsed,
          cacheUsed: canonical.cacheUsed,
          unavailable: canonical.unavailable,
        },
        source: isDome ? 'dome' : canonical.source,
      });
    }

    if (lat && lon) {
      const result = await getCachedWeatherByCoords({
        lat: parseFloat(lat),
        lng: parseFloat(lon),
      });
      const weather = result.weather;
      if (!weather) {
        return NextResponse.json(
          { error: 'Failed to fetch weather' },
          { status: 502 }
        );
      }
      return NextResponse.json({ weather, meta: result.meta, source: result.meta.cacheHit ? 'weather-cache' : 'openweathermap' });
    }

    if (city) {
      const result = await getCachedWeatherByCity({ city });
      const weather = result.weather;
      if (!weather) {
        return NextResponse.json(
          { error: 'Failed to fetch weather for city' },
          { status: 502 }
        );
      }
      return NextResponse.json({ weather, meta: result.meta, source: result.meta.cacheHit ? 'weather-cache' : 'openweathermap' });
    }

    const allTeams = [
      'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
      'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
      'LV', 'LAC', 'LAR', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
      'NYJ', 'PHI', 'PIT', 'SF', 'SEA', 'TB', 'TEN', 'WAS',
    ];

    const outdoorTeams = allTeams.filter(t => !isTeamDome(t));
    const results = await Promise.all(
      outdoorTeams.slice(0, 5).map(async (t) => {
        const gw = await getCachedGameWeather({ homeTeam: t });
        return gw ? { team: t, venue: gw.venue, weather: gw.weather } : null;
      })
    );

    return NextResponse.json({
      message:
        'Weather API ready. Use ?team=KC or ?city=Chicago or ?lat=39&lon=-94. Forecast + normalized: ?lat=&lon=&gameTime=ISO8601&forecast=1',
      sample: results.filter(Boolean).slice(0, 3),
      source: 'openweathermap',
    });
  } catch (error) {
    console.error('[Weather API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch weather', details: String(error) },
      { status: 500 }
    );
  }
})

