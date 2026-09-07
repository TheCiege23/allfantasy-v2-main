'use client'

import { usePlayerCard, usePlayerCardLeague, type PlayerCardRef } from './PlayerCardProvider'
import '@/components/core-app/af-player-card.css'

/**
 * A player's name, as a control that opens the card.
 *
 * ⚠ IT IS A `<button>`, NOT A STYLED `<span>` WITH AN onClick. The whole feature
 * is "click a name"; on a surface with forty names, keyboard and screen-reader
 * users need every one of them to be reachable and announced, and only a real
 * button gets that for free.
 *
 * ⚠ AND IT DEGRADES TO PLAIN TEXT WHEN THERE IS NOTHING TO OPEN. A player we
 * hold no id for cannot be looked up, so rendering an inert button that does
 * nothing on click would be worse than rendering the name — the affordance
 * would be a lie. `usePlayerCard` outside the provider is a no-op for the same
 * reason, so a row reused on a non-core page still renders.
 */
export default function PlayerName({
  sport,
  externalId = null,
  sleeperId = null,
  name,
  position = null,
  team = null,
  imageUrl = null,
  leagueId = null,
  className,
}: Omit<PlayerCardRef, 'name'> & { name: string; className?: string }) {
  const { open } = usePlayerCard()
  // An explicit prop wins; otherwise inherit the screen's league, if it set one.
  const scopedLeagueId = usePlayerCardLeague()
  const inLeague = leagueId ?? scopedLeagueId
  const openable = Boolean(externalId || sleeperId)

  if (!openable) {
    return <span className={className}>{name}</span>
  }

  return (
    <button
      type="button"
      className={`af-pc-trigger${className ? ` ${className}` : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        open({ sport, externalId, sleeperId, name, position, team, imageUrl, leagueId: inLeague })
      }}
    >
      {name}
    </button>
  )
}
