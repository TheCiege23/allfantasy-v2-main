import { defineMessages } from '@/lib/i18n/messages'

/**
 * The weekly sport plan's words (lib/core-app/weeklySportPlan.ts: sportWeekAdvice, buildWeeklySwings).
 * Every string is the one the module produced before the move, byte for byte, in both languages.
 */
export const weeklySportPlanMessages = defineMessages({
  en: {
    // sportWeekAdvice — one per sport key, and the fallback
    adviceNFL: 'Check bye weeks, injury designations and each player’s kickoff before replacing a starter.',
    adviceNCAAF: 'Check college injury availability, bye weeks and the league’s eligible player pool.',
    adviceNBA: 'Check rest and back-to-backs. Confirm daily, weekly, Game Pick or Lock-In rules before using game volume.',
    adviceNCAAB: 'Check college schedules, availability and category or points scoring before streaming.',
    adviceNHL: 'Review starting goalies, off-night games and category or points scoring before streaming.',
    adviceMLB: 'Review probable pitchers, confirmed batting lineups and innings/start limits before streaming.',
    adviceSOCCER: 'Check the gameweek, confirmed lineups, rotation and transfer/captain deadlines under this league’s rules.',
    adviceDefault: 'Confirm this sport’s scoring format, schedule and lineup rules before making changes.',
    // buildWeeklySwings
    evidence: (empty: number, out: number, football: boolean, bye: number | null, questionable: number) =>
      `Stored lineup: ${empty} empty slots, ${out} unavailable, ${football ? `${bye ?? 'unchecked'} on bye` : 'review schedule coverage'} and ${questionable} questionable.`,
    lineupReason: 'Empty slots and unavailable starters can affect your result; compare eligible options under your scoring format.',
    startersToReview: 'Starters to review',
    ifWinProbability: 'Estimated playoff probability if you win',
    ifLose: 'if you lose',
  },
  es: {
    adviceNFL: 'Revisa descansos, lesiones y el inicio de cada jugador antes de cambiar un titular.',
    adviceNCAAF: 'Revisa lesiones universitarias, descansos y los jugadores elegibles de la liga.',
    adviceNBA: 'Revisa descansos y partidos consecutivos. Confirma las reglas diarias, semanales, Game Pick o Lock-In antes de usar el volumen de partidos.',
    adviceNCAAB: 'Revisa calendarios universitarios, disponibilidad y puntuación por categorías o puntos antes de añadir jugadores.',
    adviceNHL: 'Revisa porteros titulares, días con pocos partidos y puntuación por categorías o puntos antes de añadir jugadores.',
    adviceMLB: 'Revisa lanzadores probables, alineaciones confirmadas y límites de entradas o aperturas antes de añadir jugadores.',
    adviceSOCCER: 'Revisa la jornada, alineaciones confirmadas, rotaciones y plazos de transferencias o capitán según las reglas de la liga.',
    adviceDefault: 'Confirma el formato de puntuación, calendario y reglas de alineación antes de cambiar jugadores.',
    evidence: (empty, out, football, bye, questionable) =>
      `Datos guardados: ${empty} huecos, ${out} ausentes, ${football ? `${bye ?? 'sin verificar'} en descanso` : 'revisa la cobertura del calendario'} y ${questionable} con dudas.`,
    lineupReason: 'Los huecos y las ausencias pueden afectar tu resultado; compara opciones elegibles según el formato.',
    startersToReview: 'Titulares para revisar',
    ifWinProbability: 'Probabilidad estimada si ganas',
    ifLose: 'si pierdes',
  },
})
