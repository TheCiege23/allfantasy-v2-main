'use client'

import { useEffect, useId, useState } from 'react'
import { ChevronDown, ChevronUp, Lock } from 'lucide-react'
import { positionTintHex } from '@/lib/draft-room/positionTint'
import type { KeeperSessionSnapshot } from '@/lib/live-draft-engine/types'

type KeeperLock = KeeperSessionSnapshot['locks'][number]

const COLLAPSE_PREF_KEY = 'af:draft-keeper-rollcall'

/** "4.9" — the board label of the pick a keeper used (round . pick-in-round). */
export function keeperPickLabel(lock: Pick<KeeperLock, 'round' | 'overall'>, teamCount: number): string {
  const inRound = teamCount > 0 ? lock.overall - (lock.round - 1) * teamCount : lock.overall
  return `${lock.round}.${inRound}`
}

/** The viewer's keepers first, then by draft slot, then by round. */
export function orderKeeperRollCall(locks: KeeperLock[], currentUserRosterId: string | null): KeeperLock[] {
  return locks.slice().sort((a, b) => {
    const aMine = currentUserRosterId != null && a.rosterId === currentUserRosterId ? 0 : 1
    const bMine = currentUserRosterId != null && b.rosterId === currentUserRosterId ? 0 : 1
    if (aMine !== bMine) return aMine - bMine
    if (a.slot !== b.slot) return a.slot - b.slot
    return a.round - b.round
  })
}

/**
 * Every kept player in the draft, in one strip above the board.
 *
 * Kept players sit in the round they cost, which is usually below the fold — so without this a
 * manager has to scroll the whole board to learn who kept whom. Collapsible (remembered per
 * browser) because a 12-team, 3-keeper league is 36 chips.
 */
export function KeeperRollCall({
  locks,
  teamCount,
  currentUserRosterId,
  teamNameByRosterId,
}: {
  locks: KeeperLock[]
  teamCount: number
  currentUserRosterId: string | null
  teamNameByRosterId?: Record<string, string | null | undefined> | null
}) {
  const listId = useId()
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSE_PREF_KEY) === 'collapsed') setCollapsed(true)
    } catch {
      /* storage unavailable — default to expanded */
    }
  }, [])

  if (!locks.length) return null

  const ordered = orderKeeperRollCall(locks, currentUserRosterId)
  const mine = ordered.filter((lock) => currentUserRosterId != null && lock.rosterId === currentUserRosterId)

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    try {
      window.localStorage.setItem(COLLAPSE_PREF_KEY, next ? 'collapsed' : 'expanded')
    } catch {
      /* best effort */
    }
  }

  return (
    <section
      aria-label="Keepers in this draft"
      data-testid="draft-keeper-rollcall"
      className="rounded-xl border border-white/10 bg-[#0b1426] px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-amber-300">
          <Lock className="h-3 w-3" strokeWidth={2.5} aria-hidden />
          Keepers · {locks.length}
        </span>
        <span className="text-xs text-white/55 max-sm:hidden">Locked in before the draft</span>
        {mine.length === 1 ? (
          <span className="text-xs text-white/80" data-testid="draft-keeper-rollcall-summary">
            Your <b className="font-bold text-cyan-300">{keeperPickLabel(mine[0], teamCount)}</b> pick goes to{' '}
            {mine[0].playerName}
          </span>
        ) : mine.length > 1 ? (
          <span className="text-xs text-white/80" data-testid="draft-keeper-rollcall-summary">
            {mine.length} of your picks go to keepers:{' '}
            <b className="font-bold text-cyan-300">{mine.map((lock) => keeperPickLabel(lock, teamCount)).join(', ')}</b>
          </span>
        ) : null}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={listId}
          data-testid="draft-keeper-rollcall-toggle"
          className="-my-2 ml-auto inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-xs font-semibold text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
        >
          {collapsed ? 'Show' : 'Hide'}
          {collapsed ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronUp className="h-3.5 w-3.5" aria-hidden />}
        </button>
      </div>
      {!collapsed ? (
        <ul id={listId} className="mt-2 flex gap-2 overflow-x-auto overscroll-x-contain pb-1" data-testid="draft-keeper-rollcall-list">
          {ordered.map((lock) => {
            const isMine = currentUserRosterId != null && lock.rosterId === currentUserRosterId
            const teamName = isMine ? 'You' : teamNameByRosterId?.[lock.rosterId]?.trim() || lock.displayName || 'Team'
            const hex = positionTintHex(lock.position) ?? '#8b949e'
            return (
              <li
                key={`${lock.rosterId}-${lock.overall}`}
                className={`flex min-w-[168px] shrink-0 items-stretch gap-2 rounded-lg border px-2 py-1.5 ${
                  isMine ? 'border-cyan-400 bg-[#0c2030]' : 'border-white/10 bg-[#101a2e]'
                }`}
                data-testid={`draft-keeper-rollcall-chip-${lock.overall}`}
              >
                <span className="w-1 shrink-0 rounded-full" style={{ backgroundColor: hex }} aria-hidden />
                <span className="flex min-w-0 flex-col gap-px">
                  <span className={`truncate text-[11px] ${isMine ? 'font-bold text-cyan-300' : 'text-white/55'}`}>{teamName}</span>
                  <span className="truncate text-[13px] font-extrabold text-white">{lock.playerName}</span>
                  <span className="truncate text-[11px] text-white/70">
                    {[lock.position, lock.team].filter(Boolean).join(' · ')} · costs Rd {lock.round}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
