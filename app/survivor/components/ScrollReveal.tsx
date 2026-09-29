'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'

export type ScrollRevealStep =
  | { type: 'vote'; targetName: string; voterLabel?: string }
  | { type: 'does_not_count'; voterLabel?: string }
  | { type: 'idol'; playerName: string; powerName: string }
  | { type: 'pause'; hostLine?: string }

export function ScrollReveal({
  steps,
  hostLines,
  reducedMotion,
  onComplete,
}: {
  steps: ScrollRevealStep[]
  hostLines?: string[]
  reducedMotion?: boolean
  onComplete?: () => void
}) {
  const [idx, setIdx] = useState(0)
  const completedRef = useRef(false)

  const tally = useMemo(() => {
    const t: Record<string, number> = {}
    for (let i = 0; i <= idx; i++) {
      const s = steps[i]
      if (s?.type === 'vote') {
        t[s.targetName] = (t[s.targetName] ?? 0) + 1
      }
    }
    return t
  }, [idx, steps])

  useEffect(() => {
    if (idx >= steps.length) {
      if (!completedRef.current) {
        completedRef.current = true
        onComplete?.()
      }
      return
    }
    const step = steps[idx]!
    const delay = reducedMotion ? 120 : step.type === 'pause' ? 600 : 900
    const t = setTimeout(() => setIdx((i) => i + 1), delay)
    return () => clearTimeout(t)
  }, [idx, onComplete, reducedMotion, steps])

  if (idx >= steps.length) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center">
        <p className="text-sm uppercase tracking-[0.25em] text-white/50">Reveal complete</p>
        <p className="mt-2 text-lg text-white/80">The tribe has spoken.</p>
      </div>
    )
  }

  const step = steps[idx]!
  const host = hostLines?.[idx] ?? (step.type === 'pause' ? step.hostLine : undefined)

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage: `radial-gradient(circle at 50% 120%, rgba(255,140,66,0.15), transparent 55%)`,
        }}
      />
      <header className="relative z-[1] flex min-h-[48px] items-center gap-2 border-b border-white/10 px-3 py-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--survivor-torch)]/25 text-sm">
          🔥
        </div>
        <p className="text-[12px] text-[var(--survivor-torch)]">The Host</p>
        {host ? <p className="ml-auto max-w-[65%] text-right text-[11px] text-white/70">{host}</p> : null}
      </header>

      <div className="relative z-[1] flex flex-1 flex-col items-center justify-center px-3">
        {step.type === 'vote' ? (
          <div
            className={clsx(
              'scroll-reveal-card w-[min(95vw,420px)] rounded-xl border border-white/10 bg-[#141a24] p-5 shadow-xl',
              reducedMotion && 'opacity-100',
            )}
            role="img"
            aria-label={`Vote for ${step.targetName}`}
          >
            <p className="text-[12px] italic text-white/45">I vote for…</p>
            <p className="mt-2 text-2xl font-bold uppercase tracking-wide text-white">{step.targetName}</p>
            {step.voterLabel ? (
              <p className="mt-3 text-[11px] text-white/35">Ballot sealed until reveal</p>
            ) : null}
          </div>
        ) : null}
        {step.type === 'does_not_count' ? (
          <div
            className="scroll-reveal-card w-[min(95vw,420px)] rounded-xl border border-red-500/30 bg-red-500/10 p-5"
            role="img"
            aria-label="This vote does not count"
          >
            <p className="text-center text-lg font-semibold text-red-200">This vote… does not count.</p>
          </div>
        ) : null}
        {step.type === 'idol' ? (
          <div className="scroll-reveal-card w-[min(95vw,420px)] rounded-xl border border-amber-400/40 bg-amber-500/10 p-5 text-center">
            <p className="text-[11px] uppercase tracking-widest text-amber-200/90">Idol played</p>
            <p className="mt-2 text-xl font-bold text-white">{step.playerName}</p>
            <p className="mt-1 text-sm text-amber-100/90">{step.powerName}</p>
          </div>
        ) : null}
        {step.type === 'pause' ? (
          <p className="text-center text-sm uppercase tracking-[0.2em] text-white/40">…</p>
        ) : null}
      </div>

      <footer
        className="relative z-[1] border-t border-white/10 bg-black/80 px-3 py-2"
        aria-live="polite"
      >
        <p className="text-[11px] uppercase tracking-wider text-white/40">Running tally</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {Object.entries(tally).map(([name, c]) => (
            <span
              key={name}
              className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-1 font-mono text-[11px] tabular-nums text-white/85"
            >
              {name} · {c}
            </span>
          ))}
        </div>
        <button
          type="button"
          className="mt-2 w-full min-h-[44px] rounded-lg border border-white/15 text-[12px] text-white/70 md:hidden"
          onClick={() => setIdx(steps.length)}
        >
          Skip to outcome
        </button>
      </footer>
    </div>
  )
}
