import { WAIVER_EDGE_ES } from '@/lib/core-app/playerCardCopy'
import { defineMessages } from '@/lib/i18n/messages'

/**
 * The Waivers screens' Competitive Edge card (components/core-app/screens/WaiverCompetitiveEdge.tsx).
 * The English is the card's former JSX, byte for byte as rendered (`&apos;` is the same ', and the
 * basis note's line breaks were JSX whitespace). The Spanish stays where it was written,
 * lib/core-app/playerCardCopy.ts's WAIVER_EDGE_ES, so the player-card copy keeps one source.
 */
export const waiverEdgeMessages = defineMessages({
  en: {
    aria: 'Competitive Edge · waivers',
    heading: 'Competitive Edge · other managers\' waiver activity',
    basis: (season: number, asOf: string, stale: boolean) =>
      `Counted from winning waiver claims in this league's Sleeper history for the ${season} season${asOf ? `, as of ${asOf} ET` : ''}${stale ? ' — may be out of date' : ''}. Sleeper doesn't publish losing bids, so these are wins only. It shows what they did, not what they'll bid.`,
  },
  es: {
    aria: WAIVER_EDGE_ES.aria,
    heading: WAIVER_EDGE_ES.heading,
    basis: WAIVER_EDGE_ES.basis,
  },
})
