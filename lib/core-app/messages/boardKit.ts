import { defineMessages } from '@/lib/i18n/messages'

/**
 * The shared board primitives (components/core-app/boards/BoardKit.tsx): the footer line under every
 * cross-league board and the no-leagues-yet panel. Both are server components that take `language` as
 * a prop, so they read this with `messagesFor`.
 * Every string is the one the component wrote before the move, byte for byte, in both languages — a
 * relocation, not a rewrite. Counts arrive already formatted (`toLocaleString(getAppIntlLocale())`)
 * beside the raw number that picks the plural, so this file imports nothing at runtime.
 *
 * The no-leagues action labels stay in the component: their Spanish is a lookup keyed by the exported
 * English `NO_LEAGUE_ACTIONS` label, a translator rather than a pair.
 */
export const boardKitMessages = defineMessages({
  en: {
    footMore: (count: string, n: number, quiet: string): string =>
      `${count} more ${n === 1 ? 'league' : 'leagues'} ${quiet}`,
    /** Also FooterSummary's default `emptyText`; only that default is translated, a caller's own text is not. */
    footAllShown: 'Every league you hold is on this board.',
    footViewAll: (count: string, _n: number): string => `View all ${count}`,
    noLeaguesAria: 'No leagues connected yet',
    noLeaguesLead: 'No leagues connected yet.',
  },
  es: {
    footMore: (count, n, quiet) => `${count} ${n === 1 ? 'liga más' : 'ligas más'} ${quiet}`,
    footAllShown: 'Todas tus ligas aparecen en esta lista.',
    footViewAll: (count, n) => `Ver ${count} ${n === 1 ? 'liga' : 'ligas'}`,
    noLeaguesAria: 'Aún no hay ligas conectadas',
    noLeaguesLead: 'Aún no hay ligas conectadas.',
  },
})
