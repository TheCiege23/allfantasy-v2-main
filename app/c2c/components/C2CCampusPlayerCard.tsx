'use client'

import type { C2CPlayerRow } from './c2cPlayerTypes'
import { C2CPlayerCardBody } from './C2CPlayerCardBody'

export function C2CCampusPlayerCard({
  player,
  pointsThisWeek,
  onOpen,
  showSide = false,
}: {
  player: C2CPlayerRow
  pointsThisWeek?: number | null
  onOpen?: () => void
  /** Mixed lists only (the bench): which side this player plays for. */
  showSide?: boolean
}) {
  const meta = [player.position, player.school, player.classYear].filter(Boolean).join(' · ')
  const tag = player.bucketState === 'devy'
    ? <span className="rounded-full bg-[var(--campus-soft)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--campus)]">Prospect</span>
    : null
  return (
    <C2CPlayerCardBody
      player={player}
      side="campus"
      meta={meta}
      tag={tag}
      sideBadge={showSide}
      pointsThisWeek={pointsThisWeek}
      onOpen={onOpen}
      testId={`c2c-campus-card-${player.playerId}`}
    />
  )
}
