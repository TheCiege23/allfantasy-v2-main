import { defineMessages } from '@/lib/i18n/messages'

/**
 * Team portfolio workspace (components/core-app/TeamPortfolioWorkspace.tsx). Every string is the one
 * the screen printed before the move, byte for byte, in both languages — a relocation, not a rewrite.
 */
export const teamPortfolioMessages = defineMessages({
  en: {
    issuesSummary: 'Player issues across teams',
    teams: (n: number): string => (n === 1 ? 'team' : 'teams'),
    shown: (visible: number, total: number) => `${visible} of ${total} teams shown`,
    notChecked: (n: number) => ` · ${n} teams could not be checked`,
    lineupIssues: (n: number) => `${n} lineup issues to review`,
    savedRead: 'Saved read: ',
    ownedIn: 'Owned in',
    leaguesStartingIn: 'leagues · starting in',
    startingAgainst: 'starting against you in',
    verifiedMatchups: 'verified matchups.',
    matchups: (n: number): string => (n === 1 ? 'matchup' : 'matchups'),
    week: 'Week',
  },
  es: {
    issuesSummary: 'Problemas de jugadores entre equipos',
    teams: (n) => (n === 1 ? 'equipo' : 'equipos'),
    shown: (visible, total) => `${visible} de ${total} equipos mostrados`,
    notChecked: (n) => ` · ${n} equipos no se pudieron revisar`,
    lineupIssues: (n) => `${n} problemas de alineación por revisar`,
    savedRead: 'Lectura guardada: ',
    ownedIn: 'En tu plantilla en',
    leaguesStartingIn: 'ligas · titular en',
    startingAgainst: 'titular contra ti en',
    verifiedMatchups: 'enfrentamientos verificados.',
    matchups: (n) => (n === 1 ? 'enfrentamiento' : 'enfrentamientos'),
    week: 'Semana',
  },
})
