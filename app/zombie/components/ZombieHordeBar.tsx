'use client'

import clsx from 'clsx'

export function ZombieHordeBar({
  hordeCount,
  survivorCount,
}: {
  hordeCount: number
  survivorCount: number
}) {
  const total = Math.max(1, hordeCount + survivorCount)
  const hordePct = Math.round((hordeCount / total) * 100)
  const survPct = 100 - hordePct
  const hordeWinning = hordePct > 50
  const urgent = survivorCount <= 3 && survivorCount > 0

  return (
    <div className="rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--zombie-text-dim)]">
        Horde vs Survivors
      </p>
      <div
        className={clsx(
          'mt-2 flex h-3 overflow-hidden rounded-full bg-white/[0.06]',
          hordeWinning && 'ring-1 ring-zombie-red/30',
          urgent && 'animate-pulse ring-2 ring-zombie-red/50',
        )}
        role="img"
        aria-label={`${hordePct} percent horde, ${survPct} percent survivors`}
      >
        <div
          className="h-full bg-gradient-to-r from-[var(--zombie-purple)] to-zombie-red/80 transition-all duration-500"
          style={{ width: `${hordePct}%` }}
        />
        <div className="h-full bg-zombie-green/35" style={{ width: `${survPct}%` }} />
      </div>
      <p className="mt-2 text-[12px] text-[var(--zombie-text-mid)]">
        <span className="text-[var(--zombie-purple)]">{hordePct}% Horde</span>
        {' — '}
        <span className="text-[var(--zombie-green)]">{survPct}% Survivors</span>
      </p>
      {hordeWinning ? (
        <p className="mt-1 text-[11px] text-[var(--zombie-red)]">The Horde is winning.</p>
      ) : null}
      {urgent ? (
        <p className="mt-1 text-[11px] font-semibold text-[var(--zombie-red)]">Final survivors phase.</p>
      ) : null}
    </div>
  )
}
