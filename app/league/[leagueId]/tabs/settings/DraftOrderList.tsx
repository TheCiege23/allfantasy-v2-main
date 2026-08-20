'use client'

import { useCallback, useMemo, useState } from 'react'
import type { DraftOrderSlotRow } from '@/lib/draft/pick-order'
import type { LeagueTeamBrief } from './types'

type DraftOrderListProps = {
  slots: DraftOrderSlotRow[]
  teams: LeagueTeamBrief[]
  method: string
  locked: boolean
  /** When true, drag/assign are disabled (member view). */
  readOnly?: boolean
  onReorder: (next: DraftOrderSlotRow[]) => void
  onAssignSlot: (slotIndex: number, teamId: string) => void
}

function teamAvatarSrc(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl?.trim()) return null
  const t = avatarUrl.trim()
  if (t.startsWith('http://') || t.startsWith('https://')) return t
  return `https://sleepercdn.com/avatars/${t}`
}

function renumberSlots(rows: DraftOrderSlotRow[]): DraftOrderSlotRow[] {
  return rows.map((r, i) => ({ ...r, slot: i + 1 }))
}

export function DraftOrderList({
  slots,
  teams,
  method,
  locked,
  readOnly = false,
  onReorder,
  onAssignSlot,
}: DraftOrderListProps) {
  const manual = method === 'manual' && !locked && !readOnly
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  const sortedTeams = useMemo(() => [...teams].sort((a, b) => a.teamName.localeCompare(b.teamName)), [teams])

  const handleDragStart = useCallback((index: number) => {
    setDragIdx(index)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDrop = useCallback(
    (dropIdx: number) => {
      if (!manual || dragIdx === null || dragIdx === dropIdx) {
        setDragIdx(null)
        return
      }
      const next = [...slots]
      const [moved] = next.splice(dragIdx, 1)
      if (!moved) {
        setDragIdx(null)
        return
      }
      next.splice(dropIdx, 0, moved)
      setDragIdx(null)
      onReorder(renumberSlots(next))
    },
    [manual, dragIdx, slots, onReorder],
  )

  const handleDragEnd = useCallback(() => setDragIdx(null), [])

  return (
    <ul className="space-y-1.5">
      {slots.map((row, idx) => {
        const empty = !row.ownerId?.trim()
        const av = teamAvatarSrc(row.avatarUrl)
        return (
          <li
            key={`slot-${row.slot}-${idx}`}
            className={`flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 ${
              manual ? 'cursor-grab active:cursor-grabbing' : ''
            } ${dragIdx === idx ? 'ring-1 ring-[#ff3d81]/40' : ''}`}
            draggable={manual}
            onDragStart={() => handleDragStart(idx)}
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(idx)}
            onDragEnd={handleDragEnd}
          >
            {manual ? (
              <span className="w-4 flex-shrink-0 text-center text-[12px] text-white/30" aria-hidden>
                ⠿
              </span>
            ) : (
              <span className="w-4 flex-shrink-0" />
            )}
            <span className="w-6 flex-shrink-0 text-center text-[11px] font-bold text-white/50">{row.slot}</span>
            {empty ? (
              <div className="flex min-h-[36px] min-w-0 flex-1 items-center rounded-lg border border-dashed border-white/[0.10] px-2 text-[12px] text-white/20">
                Empty — league not full
              </div>
            ) : (
              <>
                <div className="h-7 w-7 flex-shrink-0 overflow-hidden rounded-lg bg-white/10">
                  {av ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={av} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-white/40">
                      {(row.ownerName || '?').slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-white">{row.ownerName}</p>
                  <p className="truncate text-[10px] text-white/35">Team</p>
                </div>
              </>
            )}
            {manual && !empty ? (
              <select
                value={row.ownerId}
                onChange={(e) => onAssignSlot(idx, e.target.value)}
                className="max-w-[140px] flex-shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.05] px-1.5 py-1 text-[10px] text-white"
              >
                {sortedTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.teamName}
                  </option>
                ))}
              </select>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
