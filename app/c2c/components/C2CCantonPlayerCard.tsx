'use client'

import type { C2CPlayerRow } from './c2cPlayerTypes'
import { C2CPlayerCardBody } from './C2CPlayerCardBody'

export function C2CCantonPlayerCard({
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
  const meta = [player.position, player.nflNbaTeam].filter(Boolean).join(' · ')
  // Only what the list around it does not already say: a rookie on the bench, IR. Taxi has its own section.
  const word = player.bucketState === 'ir' ? 'IR' : player.bucketState === 'bench' && player.isRookieEligible ? 'Rookie' : null
  const tag = word ? <span className="rounded-full border border-[var(--line2)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--text2)]">{word}</span> : null
  return (
    <C2CPlayerCardBody
      player={player}
      side="canton"
      meta={meta}
      tag={tag}
      sideBadge={showSide}
      pointsThisWeek={pointsThisWeek}
      onOpen={onOpen}
      testId={`c2c-canton-card-${player.playerId}`}
    />
  )
}
