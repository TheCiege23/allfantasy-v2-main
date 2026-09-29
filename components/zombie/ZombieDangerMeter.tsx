'use client'

import clsx from 'clsx'

export type ZombieDangerLevel = 'stable' | 'exposed' | 'critical' | 'doomed'

const LEVEL_ORDER: ZombieDangerLevel[] = ['stable', 'exposed', 'critical', 'doomed']

function levelFromScore(score?: number | null): ZombieDangerLevel {
  if ((score ?? 0) >= 80) return 'doomed'
  if ((score ?? 0) >= 55) return 'critical'
  if ((score ?? 0) >= 30) return 'exposed'
  return 'stable'
}

const levelStyles: Record<ZombieDangerLevel, { bar: string; label: string; pct: number }> = {
  stable: { bar: 'from-emerald-400/90 to-emerald-600/80', label: 'text-emerald-200', pct: 22 },
  exposed: { bar: 'from-amber-300/90 to-amber-600/75', label: 'text-amber-200', pct: 48 },
  critical: { bar: 'from-orange-400/95 to-red-600/85', label: 'text-orange-200', pct: 72 },
  doomed: { bar: 'from-red-500 to-red-900', label: 'text-red-200', pct: 96 },
}

export function ZombieDangerMeter({
  riskScore,
  level: levelProp,
  className,
}: {
  /** 0–100-ish infection pressure */
  riskScore?: number | null
  level?: ZombieDangerLevel
  className?: string
}) {
  const level = levelProp ?? levelFromScore(riskScore)
  const styles = levelStyles[level]
  const displayScore = typeof riskScore === 'number' && !Number.isNaN(riskScore) ? Math.round(riskScore) : null

  return (
    <div className={clsx('space-y-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">Outbreak pressure</p>
        {displayScore != null ? (
          <span className={clsx('text-xs font-bold tabular-nums', styles.label)}>{displayScore}</span>
        ) : null}
      </div>
      <div
        className="relative h-2.5 overflow-hidden rounded-full border border-white/10 bg-black/40"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={styles.pct}
        aria-label={`Danger level ${level}`}
      >
        <div
          className={clsx(
            'h-full rounded-full bg-gradient-to-r transition-[width] duration-700 ease-out',
            styles.bar,
          )}
          style={{ width: `${styles.pct}%` }}
        />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.12),transparent)] opacity-40" />
      </div>
      <div className="flex justify-between text-[11px] uppercase tracking-[0.18em] text-white/35">
        {LEVEL_ORDER.map((l) => (
          <span key={l} className={clsx(l === level && styles.label)}>
            {l}
          </span>
        ))}
      </div>
    </div>
  )
}
