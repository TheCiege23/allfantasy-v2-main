import { defineMessages } from '@/lib/i18n/messages'

/**
 * Trade Center (components/core-app/screens/TradeCenter.tsx) — the inline English/Spanish pairs. The
 * rest of the screen goes through `tradeUiCopy`, a translator keyed by English text, and stays where it
 * is. Every string is the one the component wrote before the move, byte for byte, in both languages — a
 * relocation, not a rewrite.
 */
export const tradeCenterMessages = defineMessages({
  en: {
    /** "You get · from <their team>" — the word before the partner's name. */
    fromPartner: 'from',
  },
  es: {
    fromPartner: 'de',
  },
})
