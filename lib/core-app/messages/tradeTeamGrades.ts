import { defineMessages } from '@/lib/i18n/messages'

/**
 * Trade card copy with a grade for each team (2026-11-14): the verdict line, the per-side label, the one
 * line of numbers, and the fold. Names arrive already resolved ("You" for the reader's own team).
 */
export const tradeTeamGradesMessages = defineMessages({
  en: {
    won: (team: string): string => (team === 'You' ? 'You won this trade' : `${team} won this trade`),
    fair: 'Fair trade: both sides got about the same',
    got: (team: string): string => (team === 'You' ? 'You got' : `${team} got`),
    grade: 'Grade',
    gradeFor: (team: string, letter: string): string => `${team}: grade ${letter}`,
    values: (team: string, got: string, gave: string): string =>
      team === 'You' ? `You got ${got} in league value for ${gave}.` : `${team} got ${got} in league value for ${gave}.`,
    howGraded: 'How this was graded',
    notGraded: (reason: string) => `Not graded: ${reason}`,
    when: (week: number | null, season: number): string => (week != null ? `Week ${week}, ${season}` : String(season)),
    nothingOnRecord: 'Nothing on record for this side: FAAB only, or not captured.',
  },
  es: {
    won: (team: string): string => (team === 'You' ? 'Ganaste este cambio' : `${team} ganó este cambio`),
    fair: 'Cambio justo: los dos lados recibieron más o menos lo mismo',
    got: (team: string): string => (team === 'You' ? 'Recibiste' : `${team} recibió`),
    grade: 'Nota',
    gradeFor: (team: string, letter: string): string => `${team}: nota ${letter}`,
    values: (team: string, got: string, gave: string): string =>
      team === 'You' ? `Recibiste ${got} en valor de liga por ${gave}.` : `${team} recibió ${got} en valor de liga por ${gave}.`,
    howGraded: 'Cómo se calificó',
    notGraded: (reason: string) => `Sin nota: ${reason}`,
    when: (week: number | null, season: number): string => (week != null ? `Semana ${week}, ${season}` : String(season)),
    nothingOnRecord: 'No hay nada registrado para este lado: solo FAAB, o no se capturó.',
  },
})
