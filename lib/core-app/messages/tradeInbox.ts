import { defineMessages } from '@/lib/i18n/messages'

/**
 * Trade inbox and timeline (components/core-app/screens/TradeInbox.tsx) — the inline English/Spanish
 * pairs. The rest of the screen goes through `tradeUiCopy` / `coreUiCopy`, translators keyed by English
 * text, and the "hace N días" rewrite in `localizedWhenLabel`, which translates an English label; those
 * stay where they are. Every string is the one the component wrote before the move, byte for byte, in
 * both languages — a relocation, not a rewrite.
 */
export const tradeInboxMessages = defineMessages({
  en: {
    /** "12,400 for 9,800" — the word between the two league values. */
    valueFor: 'for',
  },
  es: {
    valueFor: 'por',
  },
})
