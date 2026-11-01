import { defineMessages } from '@/lib/i18n/messages'

/**
 * Standings maths' sentences (lib/core-app/standingsModel.ts — `leagueTiebreakReason`). Every string is
 * the one the module wrote before the move, byte for byte, in both languages — a relocation, not a
 * rewrite. Imports nothing at runtime, so the pure, client-safe module stays that way.
 */
export const standingsModelMessages = defineMessages({
  en: {
    tiebreakTo: 'to',
    tiebreakAhead: (name: string, label: string, detail: string) =>
      `${name} is ahead on ${label}${detail}, the commissioner's tiebreaker order.`,
    tiebreakLevel: "level on every one of the commissioner's tiebreakers; the order between them is not settled.",
  },
  es: {
    tiebreakTo: 'frente a',
    tiebreakAhead: (name, label, detail) => `${name} va delante por ${label}${detail}, según el orden de desempates del comisionado.`,
    tiebreakLevel: 'empatados en todos los desempates del comisionado; el orden entre ellos no está decidido.',
  },
})
