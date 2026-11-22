import { defineMessages } from '@/lib/i18n/messages'

/**
 * Weekly blueprint text (lib/core-app/weeklyBlueprint.ts: weeklyActionText, weeklyActionReason,
 * weeklyActionPrompt, weeklyBrief). Not the component catalog in ./weeklyBlueprint.ts. Every string is
 * the one the module produced before the move, byte for byte, in both languages — `weeklyBrief` is
 * Chimmy's prefill, so output must not drift.
 */
export const weeklyBlueprintTextMessages = defineMessages({
  en: {
    deadlineLineup: 'Review the confirmed lineup deadline',
    deadlineWaivers: 'Prepare claims before waiver processing',
    deadlineTrade: 'Review the confirmed trade deadline',
    actionLineup: (count: number) => `Review ${count} lineup issue${count === 1 ? '' : 's'}`,
    actionMonitor: (count: number) => `Monitor ${count} questionable starter${count === 1 ? '' : 's'}`,
    actionSync: 'Refresh your team data',
    actionPlayoff: (count: number) => `Explore period ${count} playoff scenarios`,
    actionReview: 'Review your team and its rules',
    reasonUnavailable: 'A verifiable lineup is unavailable for this league. Review import coverage before deciding; starter availability has not been checked.',
    reasonLineupOtherSport: 'Empty slots and unavailable starters can affect your result; compare eligible options under your scoring format.',
    reasonDeadline: 'A confirmed date is stored for this league. Check the rules and complete your decision before the deadline.',
    reasonLineup: 'Empty slots, absences or byes can cost points. Review eligible options.',
    reasonMonitor: 'A questionable designation can change. Check the latest status before deciding.',
    reasonSync: 'Team data is incomplete or differs from the matchup period. Refresh it before choosing players.',
    reasonPlayoff: 'Compare the win and loss scenarios and review the model’s rules.',
    reasonReview: 'Review this league’s starters and rules to prepare your next decision.',
    period: 'Period',
    confirmedDeadline: 'Confirmed deadline',
    nextGameTime: 'Next stored game time',
    promptAsk: 'Help me compare my options. Verify this league’s data, rules and official deadline; do not invent players, timing or transactions.',
    briefScopeLeagues: (n: number) => `${n} league${n === 1 ? '' : 's'}`,
    stateFinal: ' (final)',
    stateLive: ' (in progress)',
    briefMatchup: (period: number, state: string, final: boolean, opponent: string, leagueName: string) =>
      `Period ${period}${state}: ${final ? 'played' : 'facing'} ${opponent} in ${leagueName}. `,
    briefBasis: (period: number) => ` (simulated before period ${period}'s result; that game is not counted yet)`,
    briefPlayoff: (leagueName: string, pct: string, basis: string) => `Estimated playoff probability in ${leagueName}: ${pct}%${basis}. `,
    briefFirst: (actionText: string, leagueName: string) => `First: ${actionText} in ${leagueName}. `,
    brief: (scope: string, sports: string, matchup: string, playoff: string, first: string) =>
      `Your plan for ${scope}${sports}. ${matchup}${playoff}${first}Chimmy can help you weigh your options with your league context.`,
  },
  es: {
    deadlineLineup: 'Revisa el cierre de alineación',
    deadlineWaivers: 'Prepara tus reclamos antes del plazo',
    deadlineTrade: 'Revisa la fecha límite de intercambios',
    actionLineup: (count) => `Revisa ${count} problema${count === 1 ? '' : 's'} en tu alineación`,
    actionMonitor: (count) => `Vigila ${count} titular${count === 1 ? '' : 'es'} con dudas`,
    actionSync: 'Actualiza los datos de tu equipo',
    actionPlayoff: (count) => `Explora los escenarios del período ${count}`,
    actionReview: 'Revisa tu equipo y sus reglas',
    reasonUnavailable: 'No hay una alineación verificable para esta liga. Revisa la cobertura de la importación antes de decidir; no se ha comprobado que los titulares estén disponibles.',
    reasonLineupOtherSport: 'Los huecos y las ausencias pueden afectar tu resultado; compara opciones elegibles según el formato.',
    reasonDeadline: 'Hay una fecha confirmada guardada para esta liga. Comprueba las reglas y completa tu decisión antes del plazo.',
    reasonLineup: 'Los huecos, las ausencias o los descansos pueden costarte puntos. Revisa las opciones elegibles.',
    reasonMonitor: 'Una designación de duda puede cambiar. Comprueba las noticias antes de decidir.',
    reasonSync: 'Los datos están incompletos o no coinciden con el período. Actualízalos antes de elegir jugadores.',
    reasonPlayoff: 'Compara los escenarios de victoria y derrota y revisa las reglas del modelo.',
    reasonReview: 'Revisa los titulares y las reglas de esta liga para preparar tu próxima decisión.',
    period: 'Período',
    confirmedDeadline: 'Plazo confirmado',
    nextGameTime: 'Próximo partido registrado',
    promptAsk: 'Ayúdame a comparar mis opciones. Verifica los datos, las reglas y el plazo oficial de esta liga; no inventes jugadores, horarios ni movimientos.',
    briefScopeLeagues: (n) => `${n} liga${n === 1 ? '' : 's'}`,
    stateFinal: ' (finalizado)',
    stateLive: ' (en juego)',
    briefMatchup: (period, state, final, opponent, leagueName) =>
      `Período ${period}${state}: ${final ? 'jugó contra' : 'frente a'} ${opponent} en ${leagueName}. `,
    briefBasis: (period) => ` (simulada antes del resultado del período ${period}; aún no cuenta ese partido)`,
    briefPlayoff: (leagueName, pct, basis) => `Probabilidad estimada de playoffs en ${leagueName}: ${pct}%${basis}. `,
    briefFirst: (actionText, leagueName) => `Primero: ${actionText} en ${leagueName}. `,
    brief: (scope, sports, matchup, playoff, first) =>
      `Tu plan para ${scope}${sports}. ${matchup}${playoff}${first}Chimmy puede ayudarte a evaluar tus opciones con el contexto de tus ligas.`,
  },
})
