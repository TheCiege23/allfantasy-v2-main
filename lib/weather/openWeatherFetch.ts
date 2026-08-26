/**
 * The OpenWeatherMap data calls — the vendor boundary, and nothing else.
 *
 * Same shape as `lib/fantasycalc-fetch.ts`: `lib/openweathermap.ts` keeps the
 * pure half (the venue coordinate tables, `getVenueForTeam`, `isTeamDome`, and
 * the types), which request paths like `/api/sports/weather` import freely and
 * which involve no network. Splitting the FETCH out — rather than moving those
 * importers — leaves this module with only provider/caching layers:
 *   - lib/weather/weatherService.ts            the weatherCache-backed reader
 *   - lib/nfl-provider/nflRedraftProductionProviderWiring.ts  provider orchestrator
 *
 * ⚠ Importing this from a route puts an uncached, rate-limited vendor call on
 * the user's request. Go through `lib/weather/weatherService.ts` instead.
 */

import {
  NFL_TEAM_VENUES,
  NFL_VENUE_COORDS,
  type ForecastWeatherAtTime,
  type GameWeather,
  type WeatherData,
} from '@/lib/openweathermap'

const OWM_BASE_URL = 'https://api.openweathermap.org/data/2.5';

function mmToInches(mm: number): number {
  return mm * 0.0393701
}

/**
 * Moved here with the fetchers that are its only callers. It is pure, but it
 * shapes a field only these responses carry, so it belongs beside them rather
 * than exported from the venue-data module.
 */
function assessFantasyImpact(weather: {
  windSpeed: number;
  windGust: number | null;
  temp: number;
  rain1h: number | null;
  snow1h: number | null;
  visibility: number;
  condition: string;
}): { impact: string; level: 'none' | 'low' | 'moderate' | 'high' | 'extreme' } {
  const dominated = [];
  let level: 'none' | 'low' | 'moderate' | 'high' | 'extreme' = 'none';

  const effectiveWind = weather.windGust || weather.windSpeed;

  const SEVERITY_ORDER = ['none', 'low', 'moderate', 'high', 'extreme'] as const;
  const upgrade = (newLevel: typeof level) => {
    if (SEVERITY_ORDER.indexOf(newLevel) > SEVERITY_ORDER.indexOf(level)) {
      level = newLevel;
    }
  };

  if (effectiveWind >= 25) {
    dominated.push('Severe wind — major passing/kicking downgrade');
    upgrade('extreme');
  } else if (effectiveWind >= 20) {
    dominated.push('Strong wind — passing/kicking downgrade');
    upgrade('high');
  } else if (effectiveWind >= 15) {
    dominated.push('Moderate wind — slight passing concern');
    upgrade('low');
  }

  if (weather.temp <= 20) {
    dominated.push('Extreme cold — fumble risk, reduced grip');
    upgrade('high');
  } else if (weather.temp <= 32) {
    dominated.push('Cold conditions — minor fumble risk');
    upgrade('low');
  } else if (weather.temp >= 95) {
    dominated.push('Extreme heat — fatigue/cramping risk');
    upgrade('moderate');
  }

  if (weather.snow1h && weather.snow1h > 0) {
    dominated.push('Snow — favors run game, reduces passing');
    upgrade('high');
  }

  if (weather.rain1h && weather.rain1h > 5) {
    dominated.push('Heavy rain — fumble/interception risk, reduced passing');
    upgrade('high');
  } else if (weather.rain1h && weather.rain1h > 0) {
    dominated.push('Light rain — minor grip concern');
    upgrade('low');
  }

  if (weather.visibility < 1000) {
    dominated.push('Low visibility — deep ball risk');
    upgrade('moderate');
  }

  if (dominated.length === 0) {
    return { impact: 'No significant weather impact expected', level: 'none' };
  }

  return { impact: dominated.join('. '), level };
}

/**
 * 5-day / 3-hour OpenWeatherMap forecast; picks the list item whose time is closest to `targetTime`.
 */
export async function fetchForecastWeatherAtTime(
  lat: number,
  lon: number,
  targetTime: Date
): Promise<ForecastWeatherAtTime | null> {
  const apiKey = process.env.OPENWEATHERMAP_API_KEY
  if (!apiKey) {
    console.warn('[Weather] OPENWEATHERMAP_API_KEY not set')
    return null
  }

  try {
    const url = `${OWM_BASE_URL}/forecast?lat=${lat}&lon=${lon}&units=imperial&appid=${apiKey}`
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) {
      console.error('[Weather] Forecast API error:', response.status)
      return null
    }
    const data = await response.json()
    const list = data.list as Array<{
      dt: number
      main?: { temp?: number; feels_like?: number; humidity?: number }
      wind?: { speed?: number; gust?: number; deg?: number }
      clouds?: { all?: number }
      visibility?: number
      pop?: number
      rain?: { '3h'?: number }
      snow?: { '3h'?: number }
      weather?: Array<{ main?: string; id?: number; description?: string }>
    }>
    if (!Array.isArray(list) || list.length === 0) return null

    const targetMs = targetTime.getTime()
    let best = list[0]!
    let bestDelta = Math.abs(best.dt * 1000 - targetMs)
    for (const item of list) {
      const d = Math.abs(item.dt * 1000 - targetMs)
      if (d < bestDelta) {
        best = item
        bestDelta = d
      }
    }

    const rainMm = best.rain?.['3h'] ?? 0
    const snowMm = best.snow?.['3h'] ?? 0
    const windSpeed = best.wind?.speed ?? 0
    const windGust = best.wind?.gust ?? null

    return {
      temp: best.main?.temp ?? 0,
      feelsLike: best.main?.feels_like ?? best.main?.temp ?? 0,
      windSpeed,
      windGust,
      windDeg: best.wind?.deg ?? 0,
      humidity: best.main?.humidity ?? 0,
      visibilityMeters: best.visibility ?? 10000,
      clouds: best.clouds?.all ?? 0,
      rainInches3h: mmToInches(rainMm),
      snowInches3h: mmToInches(snowMm),
      conditionMain: best.weather?.[0]?.main ?? 'Clear',
      conditionCode: String(best.weather?.[0]?.id ?? ''),
      description: best.weather?.[0]?.description ?? '',
      pop: typeof best.pop === 'number' ? best.pop : 0,
      forecastDt: new Date(best.dt * 1000),
    }
  } catch (error) {
    console.error('[Weather] Forecast fetch failed:', error)
    return null
  }
}

export async function fetchWeatherByCoords(lat: number, lon: number): Promise<WeatherData | null> {
  const apiKey = process.env.OPENWEATHERMAP_API_KEY;
  if (!apiKey) {
    console.warn('[Weather] OPENWEATHERMAP_API_KEY not set');
    return null;
  }

  try {
    const url = `${OWM_BASE_URL}/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${apiKey}`;
    const response = await fetch(url, { cache: 'no-store' });

    if (!response.ok) {
      console.error('[Weather] API error:', response.status);
      return null;
    }

    const data = await response.json();

    const windSpeed = data.wind?.speed || 0;
    const windGust = data.wind?.gust || null;
    const temp = data.main?.temp || 0;
    const rain1h = data.rain?.['1h'] || null;
    const snow1h = data.snow?.['1h'] || null;
    const visibility = data.visibility || 10000;
    const condition = data.weather?.[0]?.main || 'Clear';

    const { impact, level } = assessFantasyImpact({
      windSpeed, windGust, temp, rain1h, snow1h, visibility, condition,
    });

    return {
      city: data.name || '',
      temp,
      feelsLike: data.main?.feels_like || 0,
      tempMin: data.main?.temp_min || 0,
      tempMax: data.main?.temp_max || 0,
      humidity: data.main?.humidity || 0,
      pressure: data.main?.pressure || 0,
      windSpeed,
      windGust,
      windDeg: data.wind?.deg || 0,
      description: data.weather?.[0]?.description || '',
      icon: data.weather?.[0]?.icon || '',
      iconUrl: data.weather?.[0]?.icon
        ? `https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png`
        : '',
      visibility,
      clouds: data.clouds?.all || 0,
      rain1h,
      snow1h,
      condition,
      fantasyImpact: impact,
      fantasyImpactLevel: level,
    };
  } catch (error) {
    console.error('[Weather] Fetch failed:', error);
    return null;
  }
}

export async function fetchWeatherByCity(city: string): Promise<WeatherData | null> {
  const apiKey = process.env.OPENWEATHERMAP_API_KEY;
  if (!apiKey) {
    console.warn('[Weather] OPENWEATHERMAP_API_KEY not set');
    return null;
  }

  try {
    const url = `${OWM_BASE_URL}/weather?q=${encodeURIComponent(city)},US&units=imperial&appid=${apiKey}`;
    const response = await fetch(url, { cache: 'no-store' });

    if (!response.ok) {
      console.error('[Weather] API error:', response.status);
      return null;
    }

    const data = await response.json();

    const windSpeed = data.wind?.speed || 0;
    const windGust = data.wind?.gust || null;
    const temp = data.main?.temp || 0;
    const rain1h = data.rain?.['1h'] || null;
    const snow1h = data.snow?.['1h'] || null;
    const visibility = data.visibility || 10000;
    const condition = data.weather?.[0]?.main || 'Clear';

    const { impact, level } = assessFantasyImpact({
      windSpeed, windGust, temp, rain1h, snow1h, visibility, condition,
    });

    return {
      city: data.name || city,
      temp,
      feelsLike: data.main?.feels_like || 0,
      tempMin: data.main?.temp_min || 0,
      tempMax: data.main?.temp_max || 0,
      humidity: data.main?.humidity || 0,
      pressure: data.main?.pressure || 0,
      windSpeed,
      windGust,
      windDeg: data.wind?.deg || 0,
      description: data.weather?.[0]?.description || '',
      icon: data.weather?.[0]?.icon || '',
      iconUrl: data.weather?.[0]?.icon
        ? `https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png`
        : '',
      visibility,
      clouds: data.clouds?.all || 0,
      rain1h,
      snow1h,
      condition,
      fantasyImpact: impact,
      fantasyImpactLevel: level,
    };
  } catch (error) {
    console.error('[Weather] Fetch failed:', error);
    return null;
  }
}

export async function fetchGameWeather(homeTeam: string): Promise<GameWeather | null> {
  const venueName = NFL_TEAM_VENUES[homeTeam];
  if (!venueName) {
    console.warn(`[Weather] No venue mapping for team: ${homeTeam}`);
    return null;
  }

  const venueData = NFL_VENUE_COORDS[venueName];
  if (!venueData) {
    console.warn(`[Weather] No coordinates for venue: ${venueName}`);
    return null;
  }

  if (venueData.dome) {
    return {
      venue: venueName,
      homeTeam,
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
      gameTime: '',
      isDome: true,
    };
  }

  const weather = await fetchWeatherByCoords(venueData.lat, venueData.lon);
  if (!weather) return null;

  return {
    venue: venueName,
    homeTeam,
    awayTeam: '',
    weather,
    gameTime: '',
    isDome: false,
  };
}
