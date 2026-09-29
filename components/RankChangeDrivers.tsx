'use client'

import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface RankDriver {
  id: string
  label: string
  polarity: 'UP' | 'DOWN' | 'NEUTRAL'
  value: number
  prevValue: number | null
  delta: number | null
  unit: string
}

function formatDelta(delta: number | null, unit: string): string {
  if (delta == null) return ''
  const sign = delta > 0 ? '+' : ''
  if (unit === '%') return `${sign}${delta.toFixed(1)}%`
  if (unit === 'pts') return `${sign}${delta.toFixed(1)} pts`
  return `${sign}${delta.toFixed(1)} ${unit}`
}

function PolarityIcon({ polarity }: { polarity: string }) {
  if (polarity === 'UP') return <TrendingUp className="w-3 h-3 text-emerald-400" />
  if (polarity === 'DOWN') return <TrendingDown className="w-3 h-3 text-red-400" />
  return <Minus className="w-3 h-3 text-white/30" />
}

function polarityColor(polarity: string): string {
  if (polarity === 'UP') return 'text-emerald-300'
  if (polarity === 'DOWN') return 'text-red-300'
  return 'text-white/50'
}

export default function RankChangeDrivers({
  drivers,
  title,
  compact,
}: {
  drivers: RankDriver[]
  title?: string
  compact?: boolean
}) {
  if (!drivers || drivers.length === 0) return null

  const significant = drivers.filter(d => d.polarity !== 'NEUTRAL' || (d.delta != null && Math.abs(d.delta) > 0.5))
  if (significant.length === 0) return null

  if (compact) {
    return (
      <div className="space-y-1">
        {title && <div className="text-[11px] text-white/40 font-semibold uppercase tracking-wider">{title}</div>}
        {significant.slice(0, 4).map((d) => (
          <div key={d.id} className="flex items-center gap-1.5 text-[11px]">
            <PolarityIcon polarity={d.polarity} />
            <span className="text-white/60">{d.label}</span>
            {d.delta != null && (
              <span className={`font-medium ${polarityColor(d.polarity)}`}>
                {formatDelta(d.delta, d.unit)}
              </span>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-white/5 border border-white/10 p-3">
      <div className="text-[11px] text-white/40 font-semibold uppercase tracking-wider mb-2">
        {title || 'Why this changed'}
      </div>
      <div className="space-y-1.5">
        {significant.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <PolarityIcon polarity={d.polarity} />
              <span className="text-xs text-white/70">{d.label}</span>
            </div>
            <div className="flex items-center gap-2">
              {d.delta != null && (
                <span className={`text-xs font-medium ${polarityColor(d.polarity)}`}>
                  {formatDelta(d.delta, d.unit)}
                </span>
              )}
              <span className="text-[11px] text-white/30">
                {d.value.toFixed(1)}{d.unit === '%' ? '%' : ''}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
