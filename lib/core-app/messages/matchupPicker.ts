import { defineMessages } from '@/lib/i18n/messages'

/**
 * The matchup picker's own words (components/core-app/MatchupPickerCopy.tsx). Every string is the one
 * the picker printed before the move, byte for byte, in both languages — a relocation, not a rewrite.
 */
export const matchupPickerMessages = defineMessages({
  en: {
    blurb: 'Pick a league for its full box score.',
    boardFailed: 'The all-leagues board did not load.',
    failedDetail: 'Something failed on our side — your leagues are untouched. Open one below, or ',
    tryAgain: 'try again',
    backToStanding: 'Back to where you stand',
  },
  es: {
    blurb: 'Elige una liga para ver su marcador completo.',
    boardFailed: 'El tablero de todas las ligas no se cargó.',
    failedDetail: 'Algo falló de nuestro lado; tus ligas no se vieron afectadas. Abre una abajo o ',
    tryAgain: 'inténtalo de nuevo',
    backToStanding: 'Volver a tu posición',
  },
})
