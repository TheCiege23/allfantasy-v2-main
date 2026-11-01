import { defineMessages } from '@/lib/i18n/messages'

/**
 * Screen 6, Trades (components/core-app/screens/Trades.tsx) — the inline English/Spanish pairs. The rest
 * of the screen goes through `tradeUiCopy`, which is a translator keyed by English text and stays where
 * it is. Every string is the one the component wrote before the move, byte for byte, in both languages
 * — a relocation, not a rewrite. Values arrive already formatted by the component, so this file imports
 * nothing at runtime.
 */
export const tradesScreenMessages = defineMessages({
  en: {
    perspectiveAria: (manager: string | null | undefined) => `Trade from ${manager ?? 'the first manager'}'s perspective`,
    out: 'Out',
    /**
     * `moment` is `gradeMoment(graded)` as written; `momentEs` is the same run through `tradeUiCopy`.
     * Each language picks the one it printed before.
     */
    leagueGradeLine: (got: string, gave: string, moment: string, _momentEs: string) =>
      `League grade · got ${got} for ${gave} in league value ${moment}`,
    gradingIntro: 'Grades and recommendations on this page are calculated against ',
    regularSeason: (weeks: number) => `of a ${weeks}-week regular season`,
    sharePct: (pct: number | null) => `received ${pct}% of the traded value`,
  },
  es: {
    perspectiveAria: (manager) => `Intercambio desde la perspectiva de ${manager ?? 'el primer mánager'}`,
    out: 'Sale',
    leagueGradeLine: (got, gave, _moment, momentEs) =>
      `Calificación de la liga · recibió ${got} por ${gave} en valor de liga ${momentEs}`,
    gradingIntro: 'Las calificaciones y recomendaciones usan las reglas de ',
    regularSeason: (weeks) => `de una temporada regular de ${weeks} semanas`,
    sharePct: (pct) => `recibió el ${pct}% del valor intercambiado`,
  },
})
