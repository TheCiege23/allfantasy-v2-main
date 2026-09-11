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
        /*
         * ⚠ FOCUS THE TRIGGER BEFORE OPENING, AND IT IS WEBKIT THAT NEEDS IT.
         * The sheet restores focus to whatever `document.activeElement` was when
         * it opened. Blink focuses a <button> on click, so that is this trigger.
         * WebKit does NOT — a clicked button there never takes focus — so the
         * sheet captured the containing <main> instead, and closing the card
         * dropped a Safari user at the top of the roster rather than on the row
         * they came from. Measured at 390×844 on the same journey:
         * `active=main.af-content` in WebKit against
         * `active=button.af-pc-trigger` in Chromium.
         *
         * One line here covers every surface that renders a player name, which
         * is why it belongs on the shared trigger rather than in the sheet: the
         * sheet cannot know which control asked for it.
         */
        e.currentTarget.focus()
        open({ sport, externalId, sleeperId, name, position, team, imageUrl, leagueId: inLeague })
      }}
    >
      {name}
    </button>
  )
}
