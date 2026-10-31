import type { EliminationSettle } from '@/lib/core-app/eliminationSettle'
import { defineMessages } from '@/lib/i18n/messages'

/**
 * 1st, 2nd, 3rd, 4th — for a rank within an elimination league's field. English-only, so it lives
 * beside the English copy that uses it.
 *
 * ⚠ THE TEENS ARE THE WHOLE REASON THIS IS NOT `n + ['th','st','nd','rd'][n % 10]`.
 * 11, 12 and 13 take "th" despite ending 1, 2, 3, and an 18-roster guillotine league
 * reaches all three every week.
 */
function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'
  return `${n}${suffix}`
}

/**
 * Your Week (components/core-app/screens/YourWeek.tsx). Every string is the one the screen printed
 * before the move, byte for byte, in both languages — this is a relocation, not a rewrite. Strings
 * the screen sends through `coreUiCopy` stay there.
 */
export const yourWeekMessages = defineMessages({
  en: {
    period: 'Period',
    gap: (gap: number) => `${gap.toFixed(1)} pt gap`,
    won: 'Won',
    lost: 'Lost',
    tied: 'Tied',
    live: 'Live',
    fromHistory: 'from history',
    scoreboard: 'scoreboard',
    historicalEstimate: 'historical estimate',
    matchupsSummary: (total: number) =>
      `${total} ${total === 1 ? 'matchup' : 'matchups'}, ordered by what actually needs a decision — not alphabetically.`,
    coinFlipsNote: 'History-based win probability between 40% and 60%; this is not a current lineup forecast.',
    restNote: 'History favors one side more strongly. Review your current lineup separately.',
    formPerWeek: (you: number, them: number) => ` · ${you.toFixed(1)} to ${them.toFixed(1)} per week`,
    /** A settle sub-label that replaces the shared `coreUiCopy` one; empty means use that one. */
    settleSub: (_settle: EliminationSettle): string => '',
    rankOf: (rank: number, fieldSize: number) => `${ordinal(rank)} of ${fieldSize}`,
    fieldScored: (fieldSize: number) => `${fieldSize} scored`,
    cutLine: (cutLine: number) => ` · cut line ${cutLine.toFixed(1)}`,
    preseasonBody: (kickoff: string) =>
      `Matchups fill in as weeks are scored — first kickoff ${kickoff}. There is nothing to rank before then.`,
    /** Follows the league count, which the screen renders itself. */
    withoutScheduleRest: ' of your leagues carry no schedule for this week at all and are not counted above.',
    openAll: (n: number) => `Open all ${n}`,
  },
  es: {
    period: 'Período',
    gap: (gap) => `${gap.toFixed(1)} pts de diferencia`,
    won: 'Victoria',
    lost: 'Derrota',
    tied: 'Empate',
    live: 'En juego',
    fromHistory: 'según el historial',
    scoreboard: 'marcador',
    historicalEstimate: 'estimación histórica',
    matchupsSummary: (total) => `${total} ${total === 1 ? 'enfrentamiento' : 'enfrentamientos'}, ordenados por lo que requiere una decisión.`,
    coinFlipsNote: 'Probabilidad histórica de ganar entre el 40% y el 60%; no es un pronóstico de la alineación actual.',
    restNote: 'El historial favorece más a un equipo. Revisa tu alineación actual por separado.',
    formPerWeek: (you, them) => ` · ${you.toFixed(1)} a ${them.toFixed(1)} por semana`,
    settleSub: (settle) => {
      switch (settle.verdict) {
        case 'safe': return 'decidido'
        case 'chopped': return 'decidido'
        case 'no_chop': return 'sin eliminación esta semana'
        case 'open': {
          const pending = settle.yourUpcoming + settle.yourLive
          if (pending > 0) return `${pending} por jugar`
          if (settle.cutLinePending) return 'el último equipo sigue jugando'
          return ''
        }
      }
    },
    rankOf: (rank, fieldSize) => `${rank}.º de ${fieldSize}`,
    fieldScored: (fieldSize) => `${fieldSize} con puntos`,
    cutLine: (cutLine) => ` · corte ${cutLine.toFixed(1)}`,
    preseasonBody: (kickoff) =>
      `Los enfrentamientos aparecerán al avanzar la temporada. El primer partido comienza el ${kickoff}; antes no hay nada que clasificar.`,
    withoutScheduleRest: ' de tus ligas no tienen calendario esta semana y no están incluidas arriba.',
    openAll: (n) => `Abrir ${n} ${n === 1 ? 'enfrentamiento' : 'enfrentamientos'}`,
  },
})
