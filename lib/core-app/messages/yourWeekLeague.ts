import { defineMessages } from '@/lib/i18n/messages'

/**
 * Your Week, one league (components/core-app/screens/YourWeekLeague.tsx). Every string is the one the
 * screen printed before the move, byte for byte, in both languages — this is a relocation, not a
 * rewrite. Strings the screen sends through `coreUiCopy` stay there.
 */
export const yourWeekLeagueMessages = defineMessages({
  en: {
    period: 'Period',
    youInitials: 'YOU',
    currentScoreboard: 'Current scoreboard',
    won: 'Won',
    lost: 'Lost',
    tied: 'Tied',
    inProgress: 'In progress; the result is still open.',
    historyWinProbability: 'History-based win probability',
    historicalEstimate: 'Historical scoring estimate',
    thinSample: (weeks: number) => `only ${weeks} scored ${weeks === 1 ? 'week' : 'weeks'} on file — too thin to price this`,
    firstMeeting: (opponentName: string | null) => `First meeting in imported history with ${opponentName ?? 'this team'}.`,
    formatGoal: 'Your goal depends on this league’s format. Review standings, minimums, and caps; an opponent or cut line is never assumed.',
    noOpponent: 'No opponent is confirmed for this period. It may be a bye or an incomplete schedule; verify it in your league.',
    viewStandings: 'View standings',
    restOf: (leagueName: string) => `Rest of ${leagueName}`,
    restNoteTitle: 'Historical estimates, not lineup forecasts',
    otherMatchups: (n: number) => `${n} other ${n === 1 ? 'matchup' : 'matchups'} · closest first`,
    noOtherMatchups: (leagueName: string) => `No other matchups are on file for this week in ${leagueName}.`,
    basis: (leagueName: string) =>
      `Win probability is a normal approximation over each team's scored weeks in ${leagueName}, on this league's own scoring. It is not a simulation, and it knows nothing about injuries or byes.`,
    estimateUnavailable: 'Historical estimate unavailable',
    rivalryMeetings: (n: number) => `${n} ${n === 1 ? 'meeting' : 'meetings'}`,
    rivalryYouLead: 'You lead the series',
    rivalryTheyLead: (opponentName: string | null) => `${opponentName ?? 'They'} lead the series`,
    rivalryEven: 'Dead even',
    rivalrySentence: (lead: string, meetings: string, margin: string) =>
      `${lead} over ${meetings}. Your signed scoring advantage: ${margin} points per meeting.`,
  },
  es: {
    period: 'Período',
    youInitials: 'TÚ',
    currentScoreboard: 'Marcador actual',
    won: 'Victoria',
    lost: 'Derrota',
    tied: 'Empate',
    inProgress: 'En juego; el resultado sigue abierto.',
    historyWinProbability: 'Probabilidad según el historial',
    historicalEstimate: 'Diferencia histórica estimada',
    thinSample: (weeks) =>
      `Solo hay ${weeks} ${weeks === 1 ? 'semana puntuada' : 'semanas puntuadas'} registrada${weeks === 1 ? '' : 's'}; no basta para calcular una probabilidad.`,
    firstMeeting: (opponentName) => `Primer encuentro en el historial importado con ${opponentName ?? 'este equipo'}.`,
    formatGoal: 'Tu objetivo depende del formato de esta liga. Revisa la clasificación, los mínimos y los límites; no suponemos un rival ni una línea de eliminación.',
    noOpponent: 'No hay un rival confirmado para este período. Puede ser un descanso o un calendario incompleto; compruébalo en tu liga.',
    viewStandings: 'Ver clasificación',
    restOf: (leagueName) => `Resto de ${leagueName}`,
    restNoteTitle: 'Estimaciones históricas; no son pronósticos de alineación',
    otherMatchups: (n) => `${n} ${n === 1 ? 'enfrentamiento más' : 'enfrentamientos más'} · más ajustados primero`,
    noOtherMatchups: (leagueName) => `No hay más enfrentamientos registrados esta semana en ${leagueName}.`,
    basis: (leagueName) =>
      `La probabilidad de ganar es una aproximación basada en las semanas puntuadas de cada equipo en ${leagueName}, con las reglas de esta liga. No es una simulación ni considera lesiones o descansos.`,
    estimateUnavailable: 'Estimación histórica no disponible',
    rivalryMeetings: (n) => `${n} ${n === 1 ? 'encuentro' : 'encuentros'}`,
    rivalryYouLead: 'Lideras la serie',
    rivalryTheyLead: (opponentName) => `${opponentName ?? 'Tu rival'} lidera la serie`,
    rivalryEven: 'La serie está empatada',
    rivalrySentence: (lead, meetings, margin) =>
      `${lead} tras ${meetings}. Tu diferencia de puntuación media: ${margin} puntos por encuentro.`,
  },
})

export type YourWeekLeagueMessages = (typeof yourWeekLeagueMessages)['en']
