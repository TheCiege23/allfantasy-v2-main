import { defineMessages, messagesFor } from '@/lib/i18n/messages'

/**
 * League activity on the Trades tab (2026-11-14): the adds, drops and claims that used to be the Moves
 * tab's only content of its own. Trades are not listed here; the trade history above already has them.
 *
 * ⚠ SPANISH FOLLOWS THE APP'S WORDING RULINGS (__tests__/spanish-wording-rulings.test.tsx): a waiver
 * claim is «reclamo» and no Spanish value says «waiver».
 */
export const tradesActivityMessages = defineMessages({
  en: {
    title: 'League activity',
    /** The Intl locale the row dates are written in. */
    dateLocale: 'en-US',
    sub: 'Adds, drops and claims across the league',
    added: (players: string): string => `added ${players}`,
    dropped: (players: string): string => `dropped ${players}`,
    bid: (amount: string): string => `for ${amount}`,
    aClaim: 'a waiver claim',
    aMove: 'a roster move',
    aManager: 'A manager',
    empty: 'No adds, drops or claims are on record for this league yet.',
    unavailable: 'League activity could not be read right now.',
    pick: (year: string, round: number): string => `${year} ${round}${ordinalSuffix(round)}`,
  },
  es: {
    title: 'Actividad de la liga',
    dateLocale: 'es-US',
    sub: 'Altas, bajas y reclamos en toda la liga',
    added: (players: string): string => `fichó a ${players}`,
    dropped: (players: string): string => `soltó a ${players}`,
    bid: (amount: string): string => `por ${amount}`,
    aClaim: 'un reclamo',
    aMove: 'un movimiento de plantilla',
    aManager: 'Un mánager',
    empty: 'Todavía no hay altas, bajas ni reclamos registrados en esta liga.',
    unavailable: 'No se pudo leer la actividad de la liga ahora mismo.',
    pick: (year: string, round: number): string => `${year} · ronda ${round}`,
  },
})

function ordinalSuffix(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return 'th'
  return n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
}

/**
 * "2027 round 1" (lib/core-app/persistedRecentTrades.ts names imported picks that way) as a pick reads
 * everywhere else: "2027 1st", or «2027 · ronda 1». A label in any other shape passes through.
 */
export function shortPickLabel(label: string, language: string): string {
  const m = /^(\d{4}|Future) round (\d+)$/.exec(label.trim())
  if (!m) return label
  return messagesFor(tradesActivityMessages, language).pick(m[1], Number(m[2]))
}
