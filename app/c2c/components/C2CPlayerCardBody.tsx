'use client'

import type { ReactNode } from 'react'
import type { C2CPlayerRow } from './c2cPlayerTypes'

const initials = (name: string) => name.split(' ').map((s) => s[0]).join('').slice(0, 3)

/**
 * The one player card both sides draw (2026-11-23). It says only what its list does not: the section already says
 * "Campus starters" and that they count, so a starter card carries no side badge, no "Counts" and no "STARTER".
 * `sideBadge` is for mixed lists (the bench). Points sit on the right when the week has a stored score; the old
 * "Yds — TDs — Recs —" chips were never filled by anything and are gone.
 */
export function C2CPlayerCardBody({
  player,
  side,
  meta,
  tag,
  sideBadge,
  pointsThisWeek,
  onOpen,
  testId,
}: {
  player: C2CPlayerRow
  side: 'campus' | 'canton'
  meta: string
  tag?: ReactNode
  sideBadge?: boolean
  pointsThisWeek?: number | null
  onOpen?: () => void
  testId: string
}) {
  const c = side === 'campus'
    ? { ring: 'ring-[var(--campus-line)]', text: 'text-[var(--campus)]', soft: 'bg-[var(--campus-soft)]', label: '🎓 Campus' }
    : { ring: 'ring-[var(--canton-line)]', text: 'text-[var(--canton)]', soft: 'bg-[var(--canton-soft)]', label: '🏙 Canton' }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface2)] p-2.5 text-left transition hover:border-[var(--line2)]"
      data-testid={testId}
    >
      <div className={`relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg bg-[var(--chip)] ring-2 ${c.ring}`}>
        <div className="flex h-full w-full items-center justify-center text-[11px] font-bold text-[var(--muted)]">{initials(player.playerName)}</div>
        {player.schoolLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote school logo, sized by the card
          <img src={player.schoolLogoUrl} alt="" className="absolute bottom-0 right-0 h-5 w-5 rounded-sm border border-[var(--line)] object-cover" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 break-words text-[13px] font-bold leading-snug text-[var(--text)]">{player.playerName}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--muted)]">
          <span>{meta}</span>
          {sideBadge ? <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${c.soft} ${c.text}`}>{c.label}</span> : null}
          {tag}
        </p>
      </div>
      {pointsThisWeek != null ? (
        <span className={`shrink-0 font-mono text-[15px] font-bold tabular-nums ${c.text}`}>{pointsThisWeek.toFixed(1)}</span>
      ) : null}
    </button>
  )
}
