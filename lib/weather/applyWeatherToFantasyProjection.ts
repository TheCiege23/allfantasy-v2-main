import type { SupportedSport } from '@/lib/sport-scope'
import { isWeatherSensitiveSport } from '@/lib/weather/outdoorSportMetadata'
import { calculateWeatherImpact, type WeatherImpactResult } from '@/lib/weather/weatherImpactEngine'
import type { NormalizedWeather } from '@/lib/weather/weatherService'
import type { NormalizedFantasyProjection } from '@/lib/sports-data-normalization/types'

export type WeatherProjectionAugment = {
  weatherAdjustedProjection: number | null
  weatherRiskLevel: 'none' | 'low' | 'moderate' | 'high' | 'extreme' | null
  weatherSummary: string | null
  weatherConfidence: 'high' | 'medium' | 'low' | 'unavailable' | null
  weatherImpactReason: string | null
  /** Raw forecast layer for AI prompts */
  weather: NormalizedWeather | null
  impact: WeatherImpactResult | null
}

function riskFromImpact(impact: WeatherImpactResult, baseline: number): WeatherProjectionAugment['weatherRiskLevel'] {
  if (!impact.hasWeatherData) return 'none'
  const abs = Math.abs(impact.totalAdjustment)
  const ratio = baseline > 0 ? abs / baseline : 0
  if (abs < 0.25 && ratio < 0.02) return 'none'
  if (abs < 1.0 && ratio < 0.06) return 'low'
  if (abs < 2.5 && ratio < 0.12) return 'moderate'
  if (abs < 4.5 || ratio < 0.2) return 'high'
  return 'extreme'
}

function summarizeWx(w: NormalizedWeather | null, impact: WeatherImpactResult): string | null {
  if (!w) return null
  const bits = [
    `${Math.round(w.temperatureF)}°F`,
    `${Math.round(w.windSpeedMph)} mph wind`,
    `${Math.round(w.precipChancePct)}% precip`,
    w.isDome || w.isIndoor ? 'dome/indoor' : 'outdoor',
  ]
  return `${bits.slice(0, 3).join(' · ')} — ${impact.shortReason}`
}

/**
 * Applies `calculateWeatherImpact` using an already-fetched forecast (per-team cache friendly).
 */
export function buildWeatherAugmentFromCachedWeather(args: {
  sport: SupportedSport
  position: string | null
  teamAbbrev: string | null | undefined
  baselinePoints: number
  weather: NormalizedWeather | null
}): WeatherProjectionAugment | null {
  const sport = args.sport
  if (!isWeatherSensitiveSport(sport)) return null
  if (!args.weather) {
    return {
      weatherAdjustedProjection: null,
      weatherRiskLevel: null,
      weatherSummary: null,
      weatherConfidence: 'unavailable',
      weatherImpactReason: 'Weather forecast unavailable (venue mapping or API).',
      weather: null,
      impact: null,
    }
  }

  const pos = (args.position ?? 'FLEX').toUpperCase()
  const impact = calculateWeatherImpact(sport, pos, args.weather, args.baselinePoints)
  const adjusted = args.baselinePoints + impact.totalAdjustment
  const weatherAdjustedProjection = Math.max(0, Math.round(adjusted * 1000) / 1000)

  return {
    weatherAdjustedProjection,
    weatherRiskLevel: riskFromImpact(impact, args.baselinePoints),
    weatherSummary: summarizeWx(args.weather, impact),
    weatherConfidence:
      impact.confidenceLevel === 'unavailable' ? 'low' : impact.confidenceLevel,
    weatherImpactReason: impact.shortReason,
    weather: args.weather,
    impact,
  }
}

/** Merges weather augment onto an existing normalized projection object (mutates numeric fields). */
export function mergeWeatherIntoNormalizedProjection(
  projection: NormalizedFantasyProjection,
  aug: WeatherProjectionAugment | null,
): NormalizedFantasyProjection {
  if (!aug) return projection
  const baseline =
    projection.injuryNews?.adjustedPoints ??
    projection.injuryNews?.baselinePoints ??
    projection.projectedFantasyPoints
  return {
    ...projection,
    weatherAdjustedProjection: aug.weatherAdjustedProjection,
    weatherRiskLevel: aug.weatherRiskLevel,
    weatherSummary: aug.weatherSummary,
    weatherConfidence: aug.weatherConfidence,
    weatherImpactReason: aug.weatherImpactReason,
    projectedFantasyPointsRange: adjustRangeForWeather(projection.projectedFantasyPointsRange, baseline, aug),
  }
}

function adjustRangeForWeather(
  range: NormalizedFantasyProjection['projectedFantasyPointsRange'],
  baseline: number | null,
  aug: WeatherProjectionAugment,
): NormalizedFantasyProjection['projectedFantasyPointsRange'] {
  if (baseline == null || aug.weatherAdjustedProjection == null || aug.impact == null) return range
  const delta = aug.weatherAdjustedProjection - baseline
  if (Math.abs(delta) < 1e-6) return range
  return {
    low: range.low != null ? Math.max(0, range.low + delta * 0.85) : null,
    high: range.high != null ? Math.max(0, range.high + delta * 0.85) : null,
  }
}
