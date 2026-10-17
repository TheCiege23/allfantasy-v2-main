'use client'

import { conditionEmoji } from '@/lib/weather/afProjectionAdapter'

type Props = {
  conditionLabel?: string | null
  temperatureF?: number | null
  windSpeedMph?: number | null
  precipChancePct?: number | null
  className?: string
}

export function WeatherBadge({
  conditionLabel,
  temperatureF,
  windSpeedMph,
  precipChancePct,
  className,
}: Props) {
  if (!conditionLabel && temperatureF == null && windSpeedMph == null) return null

  const parts: string[] = []
  if (conditionLabel) parts.push(conditionEmoji(conditionLabel))
  if (temperatureF !== null && temperatureF !== undefined) parts.push(`${Math.round(temperatureF)}°F`)
  if (windSpeedMph != null && windSpeedMph !== undefined && windSpeedMph > 8) {
    parts.push(`${Math.round(windSpeedMph)}mph`)
  }
  if (precipChancePct != null && precipChancePct !== undefined && precipChancePct >= 30) {
    parts.push(`${Math.round(precipChancePct)}%🌧`)
  }

  if (!parts.length) return null

  return (
    <span
      className={`inline-flex items-center text-[11px] text-white/40 ${className ?? ''}`}
      data-testid="weather-badge"
    >
      {parts.join(' · ')}
    </span>
  )
}
