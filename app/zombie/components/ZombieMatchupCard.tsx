'use client'

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { ZombieStatusBadge } from './ZombieStatusBadge'

export function ZombieMatchupCard({
  homeName,
  awayName,
  homeStatus,
  awayStatus,
  homeScore,
  awayScore,
  infectionRisk,
  riskLevel = 'na',
  margin = 0,
  mySide,
  matchStatus,
  rules,
  resolutionComplete,
}: {
  homeName: string
  awayName: string
  homeStatus: string
  awayStatus: string
  homeScore?: number | null
  awayScore?: number | null
  infectionRisk?: 'home' | 'away' | 'none'
  riskLevel?: 'low' | 'medium' | 'high' | 'critical' | 'na'
  margin?: number
  mySide?: 'home' | 'away' | null
  matchStatus?: string
  rules?: { bashingThreshold: number; maulingThreshold: number }
  resolutionComplete?: boolean
}) {
  const [outcomesOpen, setOutcomesOpen] = useState(false)
  const hs = homeScore ?? null
  const as = awayScore ?? null
  const live = matchStatus !== 'complete' && hs != null && as != null
  const diff = hs != null && as != null ? hs - as : null
  const myDiff = mySide === 'home' ? diff : mySide === 'away' ? (diff != null ? -diff : null) : null

  const riskChip = useMemo(() => {
    if (infectionRisk === 'none' || riskLevel === 'na') return null
    const map = {
      low: 'bg-[var(--zombie-green)]/20 text-[var(--zombie-green)]',
      medium: 'bg-amber-500/20 text-amber-200',
      high: 'bg-[var(--zombie-red)]/25 text-[var(--zombie-red)]',
      critical: 'animate-pulse bg-[var(--zombie-red)]/30 text-red-100',
    } as const
    const labels = { low: 'LOW RISK', medium: 'MEDIUM', high: 'HIGH RISK', critical: 'CRITICAL' } as const
    return (
      <span className={clsx('rounded px-2 py-0.5 text-[11px] font-bold', map[riskLevel])}>
        {labels[riskLevel]}
      </span>
    )
  }, [infectionRisk, riskLevel])

  const outcomeBadges = useMemo(() => {
    if (!resolutionComplete || hs == null || as == null || !rules) return null
    const winHome = hs >= as
    const m = Math.abs(hs - as)
    const bash = m >= rules.bashingThreshold
    const maul = m >= rules.maulingThreshold
    return (
      <div className="mt-2 flex flex-wrap gap-1 text-[11px] font-bold">
        {maul ? <span className="rounded bg-red-600/40 px-2 py-0.5 text-red-100">MAULING</span> : null}
        {bash && !maul ? <span className="rounded bg-orange-500/30 px-2 py-0.5 text-orange-100">BASHING</span> : null}
      </div>
    )
  }, [resolutionComplete, hs, as, rules])

  return (
    <div className="rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-[var(--zombie-text-full)]">{homeName}</span>
            <ZombieStatusBadge status={homeStatus} compact />
            {infectionRisk === 'home' ? (
              <span className="rounded bg-[var(--zombie-red)]/20 px-1.5 py-0.5 text-[11px] font-bold text-[var(--zombie-red)]">
                Infection risk
              </span>
            ) : null}
            {mySide === 'home' ? (
              <span className="text-[11px] text-teal-300/90">🧪 You</span>
            ) : null}
          </div>
          <p
            className={clsx(
              'text-2xl font-bold transition-colors',
              live && myDiff != null && myDiff < -5 ? 'text-red-300' : live && myDiff != null && myDiff > 5 ? 'text-emerald-300' : 'text-white/90',
            )}
          >
            {hs ?? '—'}
          </p>
          <div className="flex flex-wrap gap-1 text-[11px] text-[var(--zombie-text-dim)]">
            <span>🔪 +5 / 🏹 passive — public when revealed</span>
          </div>
        </div>
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-[11px] text-[var(--zombie-text-dim)]">vs</span>
          {riskChip}
          {live && mySide && infectionRisk !== 'none' ? (
            <p className="max-w-[140px] text-[11px] text-[var(--zombie-text-mid)]">
              {myDiff != null && myDiff < 0
                ? '⚠️ Falling behind — infection risk rising'
                : '✓ Trending safer'}
            </p>
          ) : null}
        </div>
        <div className="flex-1 space-y-1 text-right sm:text-right">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {infectionRisk === 'away' ? (
              <span className="rounded bg-[var(--zombie-red)]/20 px-1.5 py-0.5 text-[11px] font-bold text-[var(--zombie-red)]">
                Infection risk
              </span>
            ) : null}
            <ZombieStatusBadge status={awayStatus} compact />
            <span className="font-medium text-[var(--zombie-text-full)]">{awayName}</span>
            {mySide === 'away' ? (
              <span className="text-[11px] text-teal-300/90">🧪 You</span>
            ) : null}
          </div>
          <p
            className={clsx(
              'text-2xl font-bold transition-colors',
              live && myDiff != null && myDiff < -5 ? 'text-red-300' : live && myDiff != null && myDiff > 5 ? 'text-emerald-300' : 'text-white/90',
            )}
          >
            {as ?? '—'}
          </p>
        </div>
      </div>

      {margin > 0 && rules ? (
        <p className="mt-2 text-[11px] text-[var(--zombie-text-dim)]">Margin: {margin.toFixed(1)} pts</p>
      ) : null}

      {outcomeBadges}

      <button
        type="button"
        onClick={() => setOutcomesOpen((o) => !o)}
        className="mt-3 w-full min-h-[40px] rounded-lg border border-white/10 bg-white/[0.04] text-[11px] font-semibold text-[var(--zombie-text-mid)]"
      >
        {outcomesOpen ? 'Hide' : 'Show'} potential outcomes
      </button>
      {outcomesOpen && rules ? (
        <div className="mt-2 space-y-2 rounded-lg bg-black/25 p-3 text-[11px] text-[var(--zombie-text-mid)]">
          <p>
            <span className="font-bold text-white">IF YOU WIN:</span> stay Survivor; margin ≥ {rules.bashingThreshold}{' '}
            may trigger bashing choice; beating a Zombie may earn serum (rules).
          </p>
          <p>
            <span className="font-bold text-red-200">IF YOU LOSE:</span> infection to Zombie possible; paid leagues may
            transfer winnings.
          </p>
        </div>
      ) : null}

      {resolutionComplete && infectionRisk !== 'none' && mySide ? (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-2 text-[11px] text-[var(--zombie-text-mid)]">
          Post-game: check standings and event feed for infections, transfers, and items.
        </div>
      ) : null}
    </div>
  )
}
