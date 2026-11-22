import { defineMessages } from '@/lib/i18n/messages'

/**
 * The matchup picker's own words (components/core-app/MatchupPickerCopy.tsx). Every string is the one
 * the picker printed before the move, byte for byte, in both languages — a relocation, not a rewrite.
 */
export const matchupPickerMessages = defineMessages({
  en: {
    blurb: 'Pick a league for its full box score.',
  },
  es: {
    blurb: 'Elige una liga para ver su marcador completo.',
  },
})
