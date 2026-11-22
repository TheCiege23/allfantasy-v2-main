import type { AFProjection } from '@/lib/weather/afProjectionService'

export type AFProjectionDisplay = {
  standard: number
  af: number
  delta: number
  deltaStr: string
  reason: string
  factors: {
    label: string
    value: string
    direction: 'pos' | 'neg' | 'neutral'
  }[]
  confidence: string
  weatherLabel: string | null
  isOutdoor: boolean
  hasData: boolean
  isLoading: boolean
  error: string | null
}

function conditionEmoji(label: string): string {
  const l = label.toLowerCase()
  if (l.includes('rain') || l.includes('drizzle')) return '🌧'
  if (l.includes('snow')) return '🌨'
  if (l.includes('thunder')) return '⛈'
  if (l.includes('cloud')) return '☁️'
  if (l.includes('clear') || l.includes('sunny')) return '☀️'
  if (l.includes('wind')) return '💨'
  if (l.includes('fog') || l.includes('mist')) return '🌫'
  return '🌤'
}

function buildWeatherLabel(snap: AFProjection['weatherSnapshot']): string | null {
  if (!snap) return null
  const parts: string[] = []
  if (snap.conditionLabel) parts.push(`${conditionEmoji(snap.conditionLabel)} ${snap.conditionLabel}`)
  if (snap.temperatureF !== null && snap.temperatureF !== undefined) {
    parts.push(`${Math.round(snap.temperatureF)}°F`)
  }
  if (snap.windSpeedMph !== null && snap.windSpeedMph !== undefined && snap.windSpeedMph > 5) {
    parts.push(`${Math.round(snap.windSpeedMph)}mph wind`)
  }
  if (snap.precipChancePct !== null && snap.precipChancePct !== undefined && snap.precipChancePct > 20) {
    parts.push(`${Math.round(snap.precipChancePct)}% precip`)
  }
  return parts.length ? parts.join(' · ') : null
}

export function emptyAFProjectionDisplay(overrides: Partial<AFProjectionDisplay> = {}): AFProjectionDisplay {
  return {
    standard: 0,
    af: 0,
    delta: 0,
    deltaStr: '0.0',
    reason: '',
    factors: [],
    confidence: 'unavailable',
    weatherLabel: null,
    isOutdoor: true,
    hasData: false,
    isLoading: false,
    error: null,
    ...overrides,
  }
}

export function toAFProjectionDisplay(
  af: AFProjection | null,
  loading: boolean,
  error: string | null
): AFProjectionDisplay {
  if (loading) {
    return emptyAFProjectionDisplay({ isLoading: true, hasData: false, error: null })
  }
  if (error) {
    return emptyAFProjectionDisplay({ error, hasData: false, reason: '' })
  }
  if (!af) {
    return emptyAFProjectionDisplay({ hasData: false })
  }

  const delta = af.afProjection - af.baselineProjection

  return {
    standard: af.baselineProjection,
    af: af.afProjection,
    delta,
    deltaStr: delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1),
    reason: af.shortReason || 'No meaningful weather impact',
    factors: af.adjustmentFactors.map((f) => ({
      label: f.reason,
      value: `${f.impact >= 0 ? '+' : ''}${f.impact.toFixed(1)}`,
      direction: f.impact > 0.05 ? 'pos' : f.impact < -0.05 ? 'neg' : 'neutral',
    })),
    confidence: af.confidenceLevel,
    weatherLabel: af.weatherSnapshot ? buildWeatherLabel(af.weatherSnapshot) : null,
    isOutdoor: af.isOutdoorGame,
    hasData: af.hasWeatherData,
    isLoading: false,
    error: null,
  }
}

/** Parse POST /api/weather/af-projection JSON body into AFProjection (dates may be strings). */
export function parseAfProjectionResponse(raw: unknown): AFProjection | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.playerId !== 'string') return null
  if (typeof o.afProjection !== 'number' || typeof o.baselineProjection !== 'number') return null
  const ws = o.weatherSnapshot
  let weatherSnapshot: AFProjection['weatherSnapshot'] = null
  if (ws && typeof ws === 'object') {
    const w = ws as Record<string, unknown>
    weatherSnapshot = {
      temperatureF: typeof w.temperatureF === 'number' ? w.temperatureF : null,
      windSpeedMph: typeof w.windSpeedMph === 'number' ? w.windSpeedMph : null,
      precipChancePct: typeof w.precipChancePct === 'number' ? w.precipChancePct : null,
      conditionLabel: typeof w.conditionLabel === 'string' ? w.conditionLabel : null,
    }
  }
  const factors = Array.isArray(o.adjustmentFactors) ? o.adjustmentFactors : []
  return {
    playerId: o.playerId,
    playerName: typeof o.playerName === 'string' ? o.playerName : '',
    sport: typeof o.sport === 'string' ? o.sport : '',
    position: typeof o.position === 'string' ? o.position : '',
    baselineProjection: o.baselineProjection as number,
    weatherAdjustment: typeof o.weatherAdjustment === 'number' ? o.weatherAdjustment : 0,
    afProjection: o.afProjection as number,
    adjustmentFactors: factors as AFProjection['adjustmentFactors'],
    shortReason: typeof o.shortReason === 'string' ? o.shortReason : '',
    confidenceLevel: typeof o.confidenceLevel === 'string' ? o.confidenceLevel : 'unavailable',
    isOutdoorGame: Boolean(o.isOutdoorGame),
    hasWeatherData: typeof o.hasWeatherData === 'boolean' ? o.hasWeatherData : Boolean(o.hasWeatherData),
    weatherSnapshot,
    computedAt: o.computedAt instanceof Date ? o.computedAt : new Date(String(o.computedAt ?? Date.now())),
  }
}
