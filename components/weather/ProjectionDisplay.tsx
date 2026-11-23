'use client'

import { isWeatherSensitiveSport } from '@/lib/weather/outdoorSportMetadata'
import { AFCrestButton } from '@/components/weather/AFCrestButton'
import type { AFCrestButtonProps } from '@/components/weather/afCrestTypes'

type ProjectionDisplayProps = {
  projection: number | null | undefined
  precision?: number
  suffix?: string
  showAFCrest?: boolean
  afCrestProps?: Omit<AFCrestButtonProps, 'baselineProjection'>
  className?: string
  pointsClassName?: string
}

export function ProjectionDisplay({
  projection,
  precision = 1,
  suffix = 'proj',
  showAFCrest = true,
  afCrestProps,
  className,
  pointsClassName,
}: ProjectionDisplayProps) {
  if (projection == null) return null
  const points = projection.toFixed(precision)

  const shouldShowCrest =
    showAFCrest &&
    afCrestProps &&
    isWeatherSensitiveSport(afCrestProps.sport ?? '') &&
    !(afCrestProps.isIndoor || afCrestProps.isDome)

  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ''}`}>
      <span className={pointsClassName ?? 'text-xs text-white/55'}>
        {points}{suffix ? ' ' + suffix : null}
      </span>
      {shouldShowCrest && (
        <AFCrestButton {...afCrestProps} baselineProjection={projection} size={afCrestProps.size ?? 'xs'} />
      )}
    </span>
  )
}
