'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, ScrollText } from 'lucide-react'
import type { SurvivorScrollRevealStep } from './types'

function parseSequence(raw: unknown): SurvivorScrollRevealStep[] {
  if (!Array.isArray(raw)) return []
  const out: SurvivorScrollRevealStep[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    if ('status' in item && 'targetName' in item) {
      const row = item as { status: string; targetName: string | null }
      out.push({ type: 'ballot', targetName: row.targetName ?? 'Unnamed target', stamp: row.status === 'counts' ? '' : row.status === 'taken_by_vote_steal' ? 'Taken - Does not count' : row.status === 'blocked_by_shot' ? 'Blocked by Shot in the Dark' : row.status === 'forfeited_by_shot' ? 'Forfeited by Shot in the Dark' : 'Does not count' })
      continue
    }
    const t = (item as { type?: string }).type
    if (t === 'pause') {
      out.push({ type: 'pause' })
      continue
    }
    if (t === 'vote' && 'voterName' in item && 'targetName' in item) {
      out.push({
        type: 'vote',
        voterName: String((item as { voterName?: string }).voterName ?? ''),
        targetName: String((item as { targetName?: string }).targetName ?? ''),
      })
      continue
    }
    if (t === 'does_not_count' && 'voterName' in item) {
      out.push({
        type: 'does_not_count',
        voterName: String((item as { voterName?: string }).voterName ?? ''),
      })
      continue
    }
    if (t === 'elimination' && 'userName' in item) {
      out.push({
        type: 'elimination',
        userName: String((item as { userName?: string }).userName ?? ''),
      })
      continue
    }
    if (t === 'idol_play' && 'powerLabel' in item) {
      out.push({
        type: 'idol_play',
        powerLabel: String((item as { powerLabel?: string }).powerLabel ?? ''),
      })
    }
  }
  return out
}

function stepLabel(step: SurvivorScrollRevealStep): string {
  switch (step.type) {
    case 'ballot':
      return `${step.targetName}${step.stamp ? ` - ${step.stamp}` : ''}`
    case 'vote':
      return `${step.voterName} voted for @${step.targetName}`
    case 'does_not_count':
      return `${step.voterName}'s vote does not count`
    case 'pause':
      return '…'
    case 'elimination':
      return `@${step.userName}, you have been voted off the island.`
    case 'idol_play':
      return `Idol played: ${step.powerLabel}`
    default:
      return ''
  }
}

export interface SurvivorScrollRevealProps {
  councilWeek: number
  revealSequence: unknown
  autoPlayMs?: number
}

/**
 * Parchment-style step-through for vote reads when the council has a persisted `revealSequence`.
 */
export function SurvivorScrollReveal({ councilWeek, revealSequence, autoPlayMs = 0 }: SurvivorScrollRevealProps) {
  const steps = useMemo(() => parseSequence(revealSequence), [revealSequence])
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    setIdx(0)
    setPlaying(false)
  }, [revealSequence])

  const atEnd = idx >= steps.length
  const current = !atEnd ? steps[idx] : null

  useEffect(() => {
    if (!playing || autoPlayMs <= 0 || steps.length === 0) return
    if (idx >= steps.length) {
      setPlaying(false)
      return
    }
    const t = window.setTimeout(() => {
      setIdx((i) => i + 1)
    }, autoPlayMs)
    return () => window.clearTimeout(t)
  }, [playing, autoPlayMs, idx, steps.length])

  const next = useCallback(() => {
    setIdx((i) => Math.min(i + 1, steps.length))
  }, [steps.length])

  const restart = useCallback(() => {
    setIdx(0)
    setPlaying(false)
  }, [])

  if (steps.length === 0) {
    return (
      <p className="text-sm text-white/45" data-testid="survivor-scroll-empty">
        Scroll sequence not available yet for this council.
      </p>
    )
  }

  return (
    <div className="space-y-4" data-testid="survivor-scroll-reveal">
      <div className="relative overflow-hidden rounded-2xl border border-amber-600/25 bg-gradient-to-b from-amber-950/40 to-[#0a1228] p-5 shadow-inner">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />
        <div className="mb-3 flex items-center gap-2 text-amber-200/95">
          <ScrollText className="h-5 w-5 shrink-0 text-amber-400/90" />
          <span className="text-sm font-semibold tracking-wide">The scroll · Week {councilWeek}</span>
        </div>
        <div
          className="min-h-[5rem] font-serif text-lg leading-relaxed text-amber-50/95 md:text-xl"
          role="status"
          aria-live="polite"
        >
          {current ? (
            <span className="block motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">{stepLabel(current)}</span>
          ) : (
            <span className="text-amber-100/70">End of the scroll.</span>
          )}
        </div>
        <p className="mt-3 text-xs text-white/40">
          Step {Math.min(idx + 1, steps.length)} of {steps.length}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {!atEnd && (
          <button
            type="button"
            onClick={next}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/35 bg-cyan-950/30 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-950/50"
            data-testid="survivor-scroll-next"
          >
            <ChevronRight className="h-4 w-4" /> Next line
          </button>
        )}
        <button
          type="button"
          onClick={restart}
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
          data-testid="survivor-scroll-restart"
        >
          Restart
        </button>
        {autoPlayMs > 0 && (
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
            data-testid="survivor-scroll-autoplay"
          >
            {playing ? 'Pause auto' : 'Auto-play'}
          </button>
        )}
      </div>
    </div>
  )
}
