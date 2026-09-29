'use client'

import { useEffect, useState } from 'react'
import clsx from 'clsx'

/**
 * NFL-Draft-Style 1st Round Pick Animation.
 * Shows a dramatic reveal with player card, pick analysis, and mini scouting report.
 * Triggers on every 1st round pick for all draft types (snake, auction, 3RR, etc.).
 */

export type FirstRoundPickData = {
  id: string
  round: number
  pick: number
  overall: number
  playerName: string
  position: string
  team: string | null
  displayName: string
  teamName: string | null
  avatarUrl: string | null
  playerImageUrl: string | null
  /** Mini analysis from AI or deterministic logic */
  analysis: {
    grade: string // A+, A, B+, B, C+, C
    headline: string // "Best Player Available" / "Reach Pick" / "Steal of the Draft"
    reasoning: string // 1-2 sentence analysis
    adpDiff: number // positive = reach, negative = value
    positionalRank: number // e.g., WR3, QB1
    positionLabel: string // e.g., "WR3" or "QB1"
    keyStats: Array<{ label: string; value: string }> // projected stats
    comparisons?: string[] // player comps
  }
}

type Phase = 'entering' | 'reveal' | 'analysis' | 'exiting'

export function FirstRoundPickAnimation({
  pick,
  onComplete,
  autoAdvanceMs = 6000,
}: {
  pick: FirstRoundPickData | null
  onComplete?: () => void
  autoAdvanceMs?: number
}) {
  const [phase, setPhase] = useState<Phase>('entering')
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!pick) return
    setVisible(true)
    setPhase('entering')

    const t1 = setTimeout(() => setPhase('reveal'), 800)
    const t2 = setTimeout(() => setPhase('analysis'), 2200)
    const t3 = setTimeout(() => setPhase('exiting'), autoAdvanceMs - 500)
    const t4 = setTimeout(() => {
      setVisible(false)
      onComplete?.()
    }, autoAdvanceMs)

    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
      clearTimeout(t4)
    }
  }, [pick?.id, autoAdvanceMs, onComplete])

  if (!pick || !visible) return null

  const isReach = pick.analysis.adpDiff > 10
  const isSteal = pick.analysis.adpDiff < -10
  const isValue = pick.analysis.adpDiff < -5
  const gradeColor = getGradeColor(pick.analysis.grade)

  return (
    <div
      className={clsx(
        'pointer-events-none fixed inset-0 z-[60] flex items-center justify-center transition-opacity duration-500',
        phase === 'entering' && 'opacity-0',
        phase === 'reveal' && 'opacity-100',
        phase === 'analysis' && 'opacity-100',
        phase === 'exiting' && 'opacity-0',
      )}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[#020408]/90 backdrop-blur-md" />

      {/* Content */}
      <div className="relative w-full max-w-lg px-4">
        {/* Pick number badge */}
        <div
          className={clsx(
            'mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border-2 text-2xl font-black transition-all duration-700',
            phase === 'entering' && 'scale-0',
            phase !== 'entering' && 'scale-100',
            'border-cyan-400/40 bg-cyan-500/10 text-cyan-300',
          )}
        >
          {pick.overall}
        </div>

        {/* Main card */}
        <div
          className={clsx(
            'overflow-hidden rounded-3xl border bg-gradient-to-b from-[#0b1326] to-[#060d1f] shadow-2xl transition-all duration-700',
            phase === 'entering' && 'translate-y-8 scale-95 opacity-0',
            phase !== 'entering' && 'translate-y-0 scale-100 opacity-100',
            'border-cyan-500/20',
          )}
        >
          {/* Header strip */}
          <div className="bg-gradient-to-r from-cyan-500/10 via-transparent to-purple-500/10 px-6 py-3">
            <p className="text-center text-[11px] font-bold uppercase tracking-[0.3em] text-cyan-200/80">
              Round {pick.round} · Pick {pick.pick}
            </p>
          </div>

          {/* Player reveal */}
          <div className="px-6 py-6 text-center">
            {/* Player image placeholder */}
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-white/5 text-4xl ring-2 ring-cyan-400/20">
              {pick.position === 'QB' ? '🏈' :
               pick.position === 'RB' ? '🏃' :
               pick.position === 'WR' ? '🎯' :
               pick.position === 'TE' ? '🫱' :
               pick.position === 'K' ? '🦵' :
               pick.position === 'DEF' ? '🛡️' : '⭐'}
            </div>

            <p
              className={clsx(
                'text-3xl font-black text-white transition-all duration-500',
                phase === 'entering' && 'translate-y-4 opacity-0',
                phase !== 'entering' && 'translate-y-0 opacity-100',
              )}
            >
              {pick.playerName}
            </p>

            <div className="mt-2 flex items-center justify-center gap-2 text-sm">
              <span className="rounded-lg bg-white/10 px-2.5 py-0.5 font-bold text-white/80">
                {pick.position}
              </span>
              {pick.team && (
                <span className="text-white/50">{pick.team}</span>
              )}
              <span className="rounded bg-cyan-500/15 px-2 py-0.5 text-[11px] font-bold text-cyan-300">
                {pick.analysis.positionLabel}
              </span>
            </div>

            <p className="mt-3 text-sm text-white/50">
              Selected by <span className="font-semibold text-white/80">{pick.teamName ?? pick.displayName}</span>
            </p>
          </div>

          {/* Analysis section — slides up after reveal */}
          <div
            className={clsx(
              'border-t border-white/5 bg-black/20 px-6 py-5 transition-all duration-700',
              (phase === 'entering' || phase === 'reveal') && 'max-h-0 overflow-hidden py-0 opacity-0',
              phase === 'analysis' && 'max-h-[300px] opacity-100',
              phase === 'exiting' && 'opacity-50',
            )}
          >
            {/* Grade + Headline */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">Pick Analysis</p>
                <p className="mt-1 text-[15px] font-bold text-white">{pick.analysis.headline}</p>
              </div>
              <div
                className={clsx(
                  'flex h-12 w-12 items-center justify-center rounded-xl text-lg font-black',
                  gradeColor,
                )}
              >
                {pick.analysis.grade}
              </div>
            </div>

            {/* Reasoning */}
            <p className="mt-2 text-[12px] leading-relaxed text-white/60">
              {pick.analysis.reasoning}
            </p>

            {/* ADP diff badge */}
            <div className="mt-3 flex flex-wrap gap-2">
              {isSteal && (
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-bold text-emerald-300">
                  STEAL · {Math.abs(pick.analysis.adpDiff)} picks below ADP
                </span>
              )}
              {isValue && !isSteal && (
                <span className="rounded-full bg-sky-500/15 px-3 py-1 text-[11px] font-bold text-sky-300">
                  VALUE · {Math.abs(pick.analysis.adpDiff)} below ADP
                </span>
              )}
              {isReach && (
                <span className="rounded-full bg-amber-500/15 px-3 py-1 text-[11px] font-bold text-amber-300">
                  REACH · {pick.analysis.adpDiff} above ADP
                </span>
              )}
              {!isReach && !isValue && (
                <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold text-white/50">
                  ON VALUE · ADP match
                </span>
              )}
            </div>

            {/* Key stats */}
            {pick.analysis.keyStats.length > 0 && (
              <div className="mt-3 flex gap-3">
                {pick.analysis.keyStats.slice(0, 3).map((stat, i) => (
                  <div key={i} className="rounded-lg bg-white/5 px-3 py-1.5 text-center">
                    <p className="text-[11px] text-white/40">{stat.label}</p>
                    <p className="text-[13px] font-bold text-white">{stat.value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Comps */}
            {pick.analysis.comparisons && pick.analysis.comparisons.length > 0 && (
              <p className="mt-3 text-[11px] text-white/40">
                Comp: {pick.analysis.comparisons.join(', ')}
              </p>
            )}
          </div>
        </div>

        {/* Skip button */}
        <button
          type="button"
          onClick={() => {
            setVisible(false)
            onComplete?.()
          }}
          className="pointer-events-auto mx-auto mt-4 block text-[11px] text-white/30 hover:text-white/60"
        >
          Skip
        </button>
      </div>
    </div>
  )
}

function getGradeColor(grade: string): string {
  if (grade.startsWith('A')) return 'bg-emerald-500/20 text-emerald-300'
  if (grade === 'B+') return 'bg-sky-500/20 text-sky-300'
  if (grade.startsWith('B')) return 'bg-sky-500/15 text-sky-200'
  if (grade.startsWith('C')) return 'bg-amber-500/15 text-amber-300'
  return 'bg-white/10 text-white/50'
}

/**
 * Generate deterministic pick analysis for 1st round picks.
 * Used when AI analysis is not available or not subscribed.
 */
export function generateDeterministicAnalysis(
  playerName: string,
  position: string,
  adp: number,
  overall: number,
  positionalRank: number,
  projectedPoints?: number,
): FirstRoundPickData['analysis'] {
  const adpDiff = overall - adp
  const posLabel = `${position}${positionalRank}`

  let grade: string
  let headline: string
  let reasoning: string

  if (adpDiff < -15) {
    grade = 'A+'
    headline = 'Steal of the Draft'
    reasoning = `${playerName} at pick ${overall} is exceptional value. ADP of ${adp.toFixed(0)} means this player fell well below market price.`
  } else if (adpDiff < -5) {
    grade = 'A'
    headline = 'Great Value Pick'
    reasoning = `${playerName} represents strong value at ${posLabel}. Drafted ${Math.abs(adpDiff).toFixed(0)} picks below ADP.`
  } else if (adpDiff <= 5) {
    grade = 'B+'
    headline = 'Best Player Available'
    reasoning = `${playerName} is right on value as ${posLabel}. A solid, on-consensus selection.`
  } else if (adpDiff <= 15) {
    grade = 'B'
    headline = 'Slight Reach'
    reasoning = `${playerName} goes ${adpDiff.toFixed(0)} picks above ADP. The manager is targeting their guy early.`
  } else {
    grade = 'C+'
    headline = 'Reach Pick'
    reasoning = `${playerName} at pick ${overall} is a significant reach over ADP of ${adp.toFixed(0)}. Bold strategy or positional need.`
  }

  const keyStats: Array<{ label: string; value: string }> = []
  if (projectedPoints) {
    keyStats.push({ label: 'Proj Pts', value: projectedPoints.toFixed(1) })
  }
  keyStats.push({ label: 'ADP', value: adp.toFixed(1) })
  keyStats.push({ label: 'Pos Rank', value: posLabel })

  return {
    grade,
    headline,
    reasoning,
    adpDiff,
    positionalRank,
    positionLabel: posLabel,
    keyStats,
  }
}
