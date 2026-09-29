'use client'

import { useState } from 'react'
import type { BigBrotherMemoryWallEntry, BigBrotherUserStatus } from './types'

const STATUS_LABEL: Record<BigBrotherUserStatus, string> = {
  HOH: 'HOH',
  NOMINATED: 'Nominated',
  VETO_WINNER: 'Veto',
  VETO_PLAYER: 'Veto play',
  SAFE: 'In house',
  JURY: 'Jury',
  ELIMINATED: 'Evicted',
}

function statusStyles(status: BigBrotherUserStatus): { ring: string; badge: string } {
  switch (status) {
    case 'HOH':
      return {
        ring: 'ring-amber-400/50 shadow-[0_0_24px_rgba(245,158,11,0.2)]',
        badge: 'border-amber-500/35 bg-amber-500/15 text-amber-100',
      }
    case 'NOMINATED':
      return {
        ring: 'ring-red-400/45 shadow-[0_0_20px_rgba(248,113,113,0.15)]',
        badge: 'border-red-500/35 bg-red-950/40 text-red-100',
      }
    case 'VETO_WINNER':
    case 'VETO_PLAYER':
      return {
        ring: 'ring-cyan-400/40 shadow-[0_0_20px_rgba(34,211,238,0.12)]',
        badge: 'border-cyan-500/35 bg-cyan-950/35 text-cyan-100',
      }
    case 'JURY':
      return {
        ring: 'ring-violet-400/35',
        badge: 'border-violet-500/30 bg-violet-950/35 text-violet-100',
      }
    case 'ELIMINATED':
      return {
        ring: 'ring-white/10 opacity-75',
        badge: 'border-white/15 bg-white/[0.04] text-white/45',
      }
    default:
      return {
        ring: 'ring-white/15',
        badge: 'border-white/12 bg-white/[0.06] text-white/70',
      }
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  const one = parts[0] ?? '?'
  return one.slice(0, 2).toUpperCase()
}

export function BigBrotherMemoryWall({
  entries,
  myRosterId,
}: {
  entries: BigBrotherMemoryWallEntry[]
  myRosterId: string | null
}) {
  if (entries.length === 0) {
    return (
      <div
        className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-white/45"
        data-testid="bb-memory-wall-empty"
      >
        No houseguests yet — join the league and complete the draft to fill the wall.
      </div>
    )
  }

  return (
    <div
      className="rounded-2xl border border-amber-500/15 bg-gradient-to-b from-[#101828]/95 to-[#060a14] p-4 shadow-[0_16px_48px_rgba(0,0,0,0.35)] sm:p-5"
      data-testid="bb-memory-wall"
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200/80">Memory wall</h3>
          <p className="mt-1 text-[12px] text-white/45">Houseguests — power, block, and jury at a glance.</p>
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {entries.map((entry) => (
          <MemoryTile key={entry.rosterId} entry={entry} highlight={myRosterId === entry.rosterId} />
        ))}
      </ul>
    </div>
  )
}

function MemoryTile({
  entry,
  highlight,
}: {
  entry: BigBrotherMemoryWallEntry
  highlight: boolean
}) {
  const [imgOk, setImgOk] = useState(true)
  const { ring, badge } = statusStyles(entry.status)
  const showImg = Boolean(entry.avatarUrl && imgOk)

  return (
    <li
      className={`relative flex flex-col items-center rounded-xl border border-white/[0.06] bg-[#0a1228]/90 p-3 text-center transition-transform hover:scale-[1.02] ${
        highlight ? 'ring-2 ring-cyan-400/40' : ''
      }`}
    >
      <div
        className={`relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full ring-2 ${ring} bg-gradient-to-br from-[#1e293b] to-[#0f172a]`}
      >
        {showImg ? (
          <img
            src={entry.avatarUrl!}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setImgOk(false)}
          />
        ) : (
          <span className="text-lg font-bold text-white/85">{initials(entry.displayName)}</span>
        )}
      </div>
      <p className="mt-2 line-clamp-2 w-full text-[12px] font-semibold leading-tight text-white/90">
        {entry.displayName}
      </p>
      <span
        className={`mt-1.5 inline-flex max-w-full truncate rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge}`}
        title={STATUS_LABEL[entry.status]}
      >
        {STATUS_LABEL[entry.status]}
      </span>
    </li>
  )
}
