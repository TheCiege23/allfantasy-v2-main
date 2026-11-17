import { defineMessages } from '@/lib/i18n/messages'

/**
 * The Portfolio header and platform group heads (components/core-app/screens/Portfolio.tsx),
 * restyled to the Portfolio board (2026-11-05). The count says CLAIMED TEAMS, not leagues — see the
 * note in the screen: a league with no claimed team is absent, and two claimed teams are two rows.
 *
 * The empty state's three lines each say something different: the title says what is missing, the
 * body what the screen is for, the hint the step people miss (importing is not claiming). The body
 * used to be the service's `reason` string, which restated the title in English only.
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
    emptyBody: 'Portfolio puts every team you play, on every platform, on one board: who is starting, who is hurt, and where you are exposed.',
    emptyHint: 'Already imported a league? Open it and claim your team; it appears here on your next visit.',
  },
  es: {
    title: 'Cartera',
    teams: (n: number) => `${n} ${n === 1 ? 'equipo reclamado' : 'equipos reclamados'}`,
    commission: (n: number) => `diriges ${n}`,
    importLeague: 'Importar una liga',
    createOne: 'Crear una desde cero',
    groupCount: (n: number) => `${n} ${n === 1 ? 'liga' : 'ligas'}`,
    emptyTitle: 'Aún no hay equipos reclamados que mostrar',
    emptyBody: 'La cartera reúne en un solo tablero cada equipo que juegas, en cualquier plataforma: quién es titular, quién está lesionado y dónde estás expuesto.',
    emptyHint: '¿Ya importaste una liga? Ábrela y reclama tu equipo; aparecerá aquí en tu próxima visita.',
  },
})
