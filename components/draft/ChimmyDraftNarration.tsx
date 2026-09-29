'use client'

import { useEffect, useState } from 'react'
import clsx from 'clsx'

/**
 * Chimmy Draft Narration — 1st Round Pick Announcement
 *
 * When a player is picked in the 1st round, Chimmy announces:
 * "With the Nth pick in the 1st round of the 202X [rookie/vet/devy] draft,
 *  the [team name] select [player name] from [college/team].
 *  [Brief analysis on player and how the team may use them]"
 *
 * Includes:
 * - Dramatic entrance animation
 * - Player card with image, name, position, school/team
 * - Chimmy avatar speaking the narration
 * - Brief AI analysis (or templated if no AI subscription)
 * - Auto-dismisses after configurable duration
 */

export type ChimmyNarrationData = {
  pickNumber: number
  round: number
  season: number
  draftType: 'rookie' | 'veteran' | 'devy' | 'startup' | 'supplemental'
  teamName: string
  playerName: string
  position: string
  collegeName: string | null
  nflTeam: string | null
  playerImageUrl: string | null
  analysis: string
  grade: string | null
}

type Phase = 'entering' | 'announcing' | 'analysis' | 'exiting'

export function ChimmyDraftNarration({
  data,
  onComplete,
  autoAdvanceMs = 8000,
}: {
  data: ChimmyNarrationData | null
  onComplete?: () => void
  autoAdvanceMs?: number
}) {
  const [phase, setPhase] = useState<Phase>('entering')
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!data) return
    setVisible(true)
    setPhase('entering')

    const t1 = setTimeout(() => setPhase('announcing'), 600)
    const t2 = setTimeout(() => setPhase('analysis'), 3500)
    const t3 = setTimeout(() => setPhase('exiting'), autoAdvanceMs - 500)
    const t4 = setTimeout(() => {
      setVisible(false)
      onComplete?.()
    }, autoAdvanceMs)

    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4) }
  }, [data?.pickNumber, autoAdvanceMs, onComplete])

  if (!data || !visible) return null

  const draftLabel = data.draftType === 'rookie' ? 'Rookie Draft'
    : data.draftType === 'devy' ? 'Devy Draft'
    : data.draftType === 'veteran' ? 'Veteran Draft'
    : data.draftType === 'supplemental' ? 'Supplemental Draft'
    : 'Draft'

  const fromLabel = data.collegeName
    ? `from ${data.collegeName}`
    : data.nflTeam
      ? `${data.nflTeam}`
      : ''

  const ordinal = getOrdinal(data.pickNumber)

  return (
    <div
      className={clsx(
        'pointer-events-none fixed inset-0 z-[60] flex items-center justify-center transition-opacity duration-500',
        phase === 'entering' && 'opacity-0',
        phase !== 'entering' && 'opacity-100',
      )}
    >
      <div className="absolute inset-0 bg-[#020408]/92 backdrop-blur-md" />

      <div className="relative w-full max-w-lg px-4">
        {/* Chimmy avatar */}
        <div
          className={clsx(
            'mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 text-3xl ring-2 ring-cyan-400/30 transition-all duration-700',
            phase === 'entering' && 'scale-0',
            phase !== 'entering' && 'scale-100',
          )}
        >
          🤖
        </div>

        {/* Main card */}
        <div
          className={clsx(
            'overflow-hidden rounded-3xl border border-cyan-500/20 bg-gradient-to-b from-[#0b1326] to-[#060d1f] shadow-2xl transition-all duration-700',
            phase === 'entering' && 'translate-y-8 scale-95 opacity-0',
            phase !== 'entering' && 'translate-y-0 scale-100 opacity-100',
          )}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-cyan-500/10 via-purple-500/5 to-transparent px-6 py-3 text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-cyan-200/60">
              {data.season} {draftLabel} · Round {data.round}
            </p>
          </div>

          {/* Announcement */}
          <div className="px-6 py-5 text-center">
            {/* Pick badge */}
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border-2 border-cyan-400/30 bg-cyan-500/10 text-xl font-black text-cyan-300">
              {data.pickNumber}
            </div>

            {/* Chimmy narration text */}
            <p
              className={clsx(
                'text-[13px] leading-relaxed text-white/70 transition-all duration-700',
                phase === 'entering' && 'opacity-0',
                phase === 'announcing' && 'opacity-100',
              )}
            >
              <span className="text-cyan-300">Chimmy:</span>{' '}
              &ldquo;With the {ordinal} pick in the {getOrdinal(data.round)} round of the {data.season} {draftLabel},
            </p>

            {/* Team + Player reveal */}
            <p
              className={clsx(
                'mt-2 text-[13px] leading-relaxed text-white/70 transition-all duration-500',
                (phase === 'entering' || phase === 'announcing') && 'opacity-0 translate-y-2',
                phase === 'analysis' && 'opacity-100 translate-y-0',
              )}
            >
              the <span className="font-bold text-white">{data.teamName}</span> select{' '}
              <span className="text-xl font-black text-white">{data.playerName}</span>
              {fromLabel && <span className="text-white/60"> {fromLabel}</span>}
              .&rdquo;
            </p>

            {/* Position + grade */}
            <div className="mt-3 flex items-center justify-center gap-2">
              <span className="rounded-lg bg-white/10 px-2.5 py-0.5 text-[12px] font-bold text-white/80">
                {data.position}
              </span>
              {data.grade && (
                <span
                  className={clsx(
                    'rounded-lg px-2.5 py-0.5 text-[12px] font-bold',
                    data.grade.startsWith('A') ? 'bg-emerald-500/20 text-emerald-300' :
                    data.grade.startsWith('B') ? 'bg-sky-500/20 text-sky-300' :
                    'bg-amber-500/20 text-amber-300',
                  )}
                >
                  {data.grade}
                </span>
              )}
            </div>
          </div>

          {/* Analysis — slides up */}
          <div
            className={clsx(
              'border-t border-white/5 bg-black/20 px-6 py-4 transition-all duration-700',
              (phase === 'entering' || phase === 'announcing') && 'max-h-0 overflow-hidden py-0 opacity-0',
              phase === 'analysis' && 'max-h-[200px] opacity-100',
              phase === 'exiting' && 'opacity-50',
            )}
          >
            <p className="text-[12px] leading-relaxed text-white/60 italic">
              &ldquo;{data.analysis}&rdquo;
            </p>
            <p className="mt-2 text-right text-[11px] text-cyan-300/50">— Chimmy, AllFantasy AI</p>
          </div>
        </div>

        {/* Skip */}
        <button
          type="button"
          onClick={() => { setVisible(false); onComplete?.() }}
          className="pointer-events-auto mx-auto mt-3 block text-[11px] text-white/20 hover:text-white/50"
        >
          Skip
        </button>
      </div>
    </div>
  )
}

/**
 * Generate a default narration analysis when AI is not available.
 */
export function generateDefaultNarration(
  playerName: string,
  position: string,
  teamName: string,
  collegeName: string | null,
): string {
  const posLabels: Record<string, string> = {
    QB: 'signal-caller',
    RB: 'ball-carrier',
    WR: 'pass-catcher',
    TE: 'versatile tight end',
    K: 'kicker',
    DEF: 'defensive unit',
    DL: 'defensive lineman',
    LB: 'linebacker',
    DB: 'defensive back',
  }

  const posLabel = posLabels[position] ?? 'player'
  const from = collegeName ? ` out of ${collegeName}` : ''

  return `${playerName} is an exciting ${posLabel}${from} who should make an immediate impact for ${teamName}. Look for this selection to address a key roster need and strengthen the team's long-term outlook.`
}

function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
