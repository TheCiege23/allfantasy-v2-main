import { defineMessages } from '@/lib/i18n/messages'

/**
 * Carryover + coverage (components/core-app/screens/Dash34CarryoverView.tsx). Every string is the one
 * the cards printed before the move, byte for byte, in both languages — this is a relocation, not a
 * rewrite. The server-written sentences are still rebuilt from their parts by `homeBandsCopy`; only
 * the view's own fixed labels live here.
 */
export const dashCarryoverMessages = defineMessages({
  en: {
    mostUrgent: 'Most urgent',
    chimmyBrief: 'Chimmy brief',
    notWatching: 'What this screen is not watching',
  },
  es: {
    mostUrgent: 'Lo más urgente',
    chimmyBrief: 'Resumen de Chimmy',
    notWatching: 'Lo que esta pantalla no vigila',
  },
})
