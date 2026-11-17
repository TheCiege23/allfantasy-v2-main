'use client'

import { isWeatherSensitiveSport } from '@/lib/weather/outdoorSportMetadata'
import { AFCrestButton } from '@/components/weather/AFCrestButton'
import type { AFCrestButtonProps } from '@/components/weather/afCrestTypes'

type ProjectionDisplayProps = {
  projection: number | null | undefined
  suffix?: string
  showAFCrest?: boolean
  afCrestProps?: Omit<AFCrestButtonProps, 'baselineProjection'>
  className?: string
  pointsClassName?: string
}

export function ProjectionDisplay({
  projection,
  suffix = 'proj',
  showAFCrest = true,
  afCrestProps,
  className,
  pointsClassName,
}: ProjectionDisplayProps) {
  if (projection == null) return null

  const shouldShowCrest =
    showAFCrest &&
    afCrestProps &&
    isWeatherSensitiveSport(afCrestProps.sport ?? '') &&
    !(afCrestProps.isIndoor || afCrestProps.isDome)

  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ''}`}>
      <span className={pointsClassName ?? 'text-xs text-white/55'}>
        {suffix ? `${projection.toFixed(1)} ${suffix}` : projection.toFixed(1)}
      </span>
      {shouldShowCrest && (
        <AFCrestButton {...afCrestProps} baselineProjection={projection} size={afCrestProps.size ?? 'xs'} />
      )}
    </span>
  )
}
