'use client'

export type SimulationConfidenceIndicatorProps = {
  /** 0–100 model confidence */
  confidenceScore: number
  /** low | medium | high */
  volatility?: 'low' | 'medium' | 'high'
  /** e.g. "Updated 2 hours ago" or ISO string */
  dataFreshness?: string
  /** Optional: number of simulations run */
  simulationCount?: number
  className?: string
}

function confidenceLabel(score: number): string {
  if (score >= 75) return 'High confidence'
  if (score >= 50) return 'Good confidence'
  if (score >= 25) return 'Moderate confidence'
  return 'Limited confidence'
}

function confidenceColor(score: number): string {
  if (score >= 75) return 'text-emerald-400'
  if (score >= 50) return 'text-cyan-400'
  if (score >= 25) return 'text-amber-400'
  return 'text-white/50'
}

export function SimulationConfidenceIndicator({
  confidenceScore,
  volatility,
  dataFreshness,
  simulationCount,
  className = '',
}: SimulationConfidenceIndicatorProps) {
  const clamped = Math.max(0, Math.min(100, confidenceScore))
  const label = confidenceLabel(clamped)
  const colorClass = confidenceColor(clamped)

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 ${className}`}
    >
      <div className="flex items-center gap-2">
        <div className="w-16 h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-cyan-500/80 transition-all duration-300"
            style={{ width: `${clamped}%` }}
          />
        </div>
        <span className={`text-[11px] font-medium ${colorClass}`} title="Model confidence (data + sims)">
          {label}
        </span>
      </div>
      {volatility && (
        <span
          className={`text-[11px] px-2 py-0.5 rounded-full ${
            volatility === 'high'
              ? 'bg-amber-500/20 text-amber-400'
              : volatility === 'medium'
                ? 'bg-cyan-500/20 text-cyan-400'
                : 'bg-white/10 text-white/50'
          }`}
        >
          {volatility === 'high' ? 'High volatility' : volatility === 'medium' ? 'Medium volatility' : 'Low volatility'}
        </span>
      )}
      {dataFreshness && (
        <span className="text-[11px] text-white/40" title="When inputs were last updated">
          {dataFreshness}
        </span>
      )}
      {simulationCount != null && simulationCount > 0 && (
        <span className="text-[11px] text-white/30">
          {simulationCount.toLocaleString()} sims
        </span>
      )}
    </div>
  )
}
