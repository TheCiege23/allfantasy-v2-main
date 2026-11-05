import { defineMessages } from '@/lib/i18n/messages'

/**
 * The Portfolio header and platform group heads (components/core-app/screens/Portfolio.tsx),
 * restyled to the Portfolio board (2026-11-05). The count says CLAIMED TEAMS, not leagues — see the
 * note in the screen: a league with no claimed team is absent, and two claimed teams are two rows.
 */
export const portfolioHeaderMessages = defineMessages({
  en: {
    title: 'Portfolio',
    teams: (n: number) => `${n} claimed ${n === 1 ? 'team' : 'teams'}`,
    commission: (n: number) => `you commission ${n}`,
    importLeague: 'Import a league',
    createOne: 'Create one from scratch',
    groupCount: (n: number) => `${n} ${n === 1 ? 'league' : 'leagues'}`,
    emptyTitle: 'No claimed teams to show yet',
  },
  es: {
    title: 'Cartera',
    teams: (n: number) => `${n} ${n === 1 ? 'equipo reclamado' : 'equipos reclamados'}`,
    commission: (n: number) => `diriges ${n}`,
    importLeague: 'Importar una liga',
    createOne: 'Crear una desde cero',
    groupCount: (n: number) => `${n} ${n === 1 ? 'liga' : 'ligas'}`,
    emptyTitle: 'Aún no hay equipos reclamados que mostrar',
  },
})
