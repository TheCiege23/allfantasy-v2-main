import { defineMessages } from '@/lib/i18n/messages'

/**
 * The shared board primitives (components/core-app/boards/BoardKit.tsx): the footer line under every
 * cross-league board and the no-leagues-yet panel. Both are server components that take `language` as
 * a prop, so they read this with `messagesFor`.
 * Every string is the one the component wrote before the move, byte for byte, in both languages — a
 * relocation, not a rewrite. Counts arrive already formatted (`toLocaleString(getAppIntlLocale())`)
 * beside the raw number that picks the plural, so this file imports nothing at runtime.
 *
 * `noLeagueAction` is handed an exported `NO_LEAGUE_ACTIONS` label and returns it unchanged in English;
 * Spanish looks it up by that English label and falls back to it.
 */

const NO_LEAGUE_ACTION_ES: Record<string, string> = {
  'Connect a league': 'Conectar una liga',
  'Try a mock draft': 'Probar un draft simulado',
  'Grade a trade': 'Evaluar un intercambio',
}

export const boardKitMessages = defineMessages({
  en: {
    footMore: (count: string, n: number, quiet: string): string =>
      `${count} more ${n === 1 ? 'league' : 'leagues'} ${quiet}`,
    /** Also FooterSummary's default `emptyText`; only that default is translated, a caller's own text is not. */
    footAllShown: 'Every league you hold is on this board.',
    footViewAll: (count: string, _n: number): string => `View all ${count}`,
    noLeaguesAria: 'No leagues connected yet',
    noLeaguesLead: 'No leagues connected yet.',
    noLeagueAction: (label: string): string => label,
  },
  es: {
    footMore: (count, n, quiet) => `${count} ${n === 1 ? 'liga más' : 'ligas más'} ${quiet}`,
    footAllShown: 'Todas tus ligas aparecen en esta lista.',
    footViewAll: (count, n) => `Ver ${count} ${n === 1 ? 'liga' : 'ligas'}`,
    noLeaguesAria: 'Aún no hay ligas conectadas',
    noLeaguesLead: 'Aún no hay ligas conectadas.',
    noLeagueAction: (label) => NO_LEAGUE_ACTION_ES[label] ?? label,
  },
})
