'use client'

import {
  DRAFT_ROOM_PLAYER_LABEL_TEXT,
  resolveDraftRoomPlayerLabel,
  type DraftRoomPlayerLabelInput,
} from '@/lib/draft-room/draftRoomPlayerLabel'

const LABEL_CLASS = {
  rookie: 'border-lime-300/40 bg-lime-500/18 text-lime-100',
  prospect: 'border-amber-300/40 bg-amber-500/18 text-amber-100',
} as const

/** Rookie / Prospect chip for a draft-room player, identical for every sport. Renders nothing when unknown. */
export function DraftPlayerLabelBadge({
  player,
  className = '',
}: {
  player: DraftRoomPlayerLabelInput
  className?: string
}) {
  const label = resolveDraftRoomPlayerLabel(player)
  if (!label) return null
  return (
    <span
      data-testid="draft-player-label-badge"
      data-label={label}
      className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${LABEL_CLASS[label]} ${className}`}
    >
      {DRAFT_ROOM_PLAYER_LABEL_TEXT[label]}
    </span>
  )
}
