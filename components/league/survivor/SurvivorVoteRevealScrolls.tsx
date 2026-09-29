'use client'

import { useEffect, useState } from 'react'

export type RevealScroll = {
  order: number
  targetUserId: string | null
  targetName: string | null
  status: 'counts' | 'late_does_not_count' | 'blocked_by_idol' | 'target_safe'
  isExtraVote: boolean
}

const STATUS_COPY: Record<RevealScroll['status'], { label: string; tone: string }> = {
  counts: { label: '', tone: 'text-amber-100' },
  late_does_not_count: { label: 'Does Not Count', tone: 'text-neutral-400' },
  blocked_by_idol: { label: 'Blocked by Idol', tone: 'text-sky-300' },
  target_safe: { label: 'Safe — Does Not Count', tone: 'text-emerald-300' },
}

/**
 * TV-style parchment vote reveal. Reveals one scroll at a time on a timer, stamping
 * "Does Not Count" / "Blocked by Idol" on invalidated ballots. Voter identity is never shown —
 * only the name written on the parchment (the target). Mobile-safe (single column, wraps).
 */
export function SurvivorVoteRevealScrolls({
  scrolls,
  eliminatedName,
  isTie,
  tiePhase,
  autoPlay = true,
}: {
  scrolls: RevealScroll[]
  eliminatedName: string | null
  isTie: boolean
  tiePhase: string | null
  autoPlay?: boolean
}) {
  const [shown, setShown] = useState(autoPlay ? 0 : scrolls.length)

  useEffect(() => {
    if (!autoPlay) {
      setShown(scrolls.length)
      return
    }
    setShown(0)
    if (scrolls.length === 0) return
    let i = 0
    const timer = setInterval(() => {
      i += 1
      setShown(i)
      if (i >= scrolls.length) clearInterval(timer)
    }, 900)
    return () => clearInterval(timer)
  }, [scrolls, autoPlay])

  if (scrolls.length === 0) {
    return <p className="text-xs text-neutral-500">No ballots were cast at this council.</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" aria-label="Vote reveal">
        {scrolls.slice(0, shown).map((s) => {
          const copy = STATUS_COPY[s.status]
          const invalid = s.status !== 'counts'
          return (
            <div
              key={s.order}
              className={`min-w-[120px] flex-1 rounded-md border px-3 py-3 text-center shadow-sm ${
                invalid ? 'border-neutral-700 bg-neutral-900/60' : 'border-amber-700/50 bg-amber-950/30'
              }`}
              style={{ fontFamily: 'ui-serif, Georgia, serif' }}
            >
              <div className={`text-base font-semibold ${invalid ? 'text-neutral-300 line-through' : 'text-amber-100'}`}>
                {s.targetName ?? '—'}
              </div>
              {copy.label ? <div className={`mt-1 text-[11px] font-bold uppercase tracking-wide ${copy.tone}`}>{copy.label}</div> : null}
              {s.isExtraVote ? <div className="mt-1 text-[11px] uppercase tracking-wide text-purple-300">Extra Vote</div> : null}
            </div>
          )
        })}
      </div>

      {shown >= scrolls.length ? (
        <div className="rounded-md border border-orange-600/40 bg-orange-950/30 p-3 text-center">
          {isTie ? (
            <div className="text-sm font-semibold text-amber-200">
              It&apos;s a tie. {tiePhase === 'commissioner_tiebreak_required' ? 'A commissioner tiebreak is required.' : 'A revote is required.'}
            </div>
          ) : eliminatedName ? (
            <div className="text-sm font-semibold text-orange-200">🔥 {eliminatedName}, the tribe has spoken.</div>
          ) : (
            <div className="text-sm text-neutral-300">No valid votes counted — no one was voted out.</div>
          )}
        </div>
      ) : (
        <div className="text-center text-[11px] text-neutral-500">Reading the votes…</div>
      )}
    </div>
  )
}

export default SurvivorVoteRevealScrolls
