import { defineMessages } from '@/lib/i18n/messages'

/**
 * The in-league tab bar (components/core-app/LeagueTabs.tsx) and its absent-view notes
 * (`describeHiddenTabs`). The tab labels themselves come from navLabel()/coreUiCopy(); only the
 * compact strip's Spanish short labels live here, keyed by tab key, with English passing the
 * navLabel() label through. Every string is the one the component wrote before the move, byte for
 * byte, in both languages — a relocation, not a rewrite.
 */
const COMPACT_ES: Record<string, string> = {
  '': 'Resumen',
  'my-team': 'Equipo',
  matchup: 'Partido',
  players: 'Jugad.',
  moves: 'Movimientos',
}

export const leagueTabsMessages = defineMessages({
  en: {
    navAria: (leagueName: string) => `${leagueName} views`,
    openLeague: 'Open League',
    /** The compact strip's label for `key`; English is the navLabel() label it is given. */
    compactTab: (_key: string, label: string): string => label,
    commissioner: 'Commissioner',

    // describeHiddenTabs
    thisPlatform: 'this platform',
    noScoredWeek: 'Matchup, Your week, Standings and Outlook open once this league has a scored week — they are all built from one.',
    noTrades: (label: string) => `We couldn’t bring across trade history from ${label} for this league yet, so there is no Trades view.`,
    noDraft: (label: string) => `We couldn’t bring across draft results from ${label} for this league yet, so there is no Draft HQ view.`,
  },
  es: {
    navAria: (leagueName) => `Secciones de ${leagueName}`,
    openLeague: 'Abrir liga',
    compactTab: (key, label) => COMPACT_ES[key] ?? label,
    commissioner: 'Comisionado',

    thisPlatform: 'esta plataforma',
    noScoredWeek: 'Enfrentamiento, Tu semana, Clasificación y Pronóstico se abren cuando esta liga tenga una semana puntuada.',
    noTrades: (label) => `Aún no pudimos importar el historial de intercambios de ${label} para esta liga; la vista de Intercambios no está disponible.`,
    noDraft: (label) => `Aún no pudimos importar los resultados del draft de ${label} para esta liga; la vista de Draft HQ no está disponible.`,
  },
})
