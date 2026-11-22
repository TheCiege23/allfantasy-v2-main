import { defineMessages } from '@/lib/i18n/messages'

/**
 * Weekly share text (lib/core-app/weeklyShare.ts: rivalryNarrative, weeklySocialPost,
 * commissionerWeekDraft, drawWeeklyShareCard) and the workbook's Brief label (weeklyWorkbook.ts).
 * Not the component catalog in ./weeklySharing.ts.
 * These strings become social posts, commissioner drafts and the share-card image, so every one is
 * the module's previous output byte for byte, in both languages.
 */
export const weeklyShareTextMessages = defineMessages({
  en: {
    // rivalryNarrative
    record: (wins: number, losses: number, ties: number) => ` Imported series: ${wins}-${losses}-${ties} (wins-losses-ties).`,
    wonLast: (firstPerson: boolean, opponent: string, final: boolean) =>
      `${firstPerson ? 'I won' : 'You won'} the last imported meeting with ${opponent}.${final ? '' : ' Let’s make it two in a row!'}`,
    wonStreak: (firstPerson: boolean, opponent: string, streak: number, final: boolean) =>
      `In imported meetings before this period, ${firstPerson ? 'I' : 'you'} beat ${opponent} ${streak} straight times.${final ? '' : ` Let’s make it ${streak + 1}!`}`,
    lostStreak: (opponent: string, streak: number, record: string) =>
      `In imported history, ${opponent} won the last ${streak} ${streak === 1 ? 'meeting' : 'meetings'} before this period. This week is a chance to change the story.${record}`,
    series: (opponent: string, wins: number, losses: number, ties: number) =>
      `Imported series against ${opponent}: ${wins}-${losses}-${ties} (wins-losses-ties).`,
    // weeklySocialPost
    myFantasyWeek: 'My fantasy week',
    myPriority: 'My priority',
    period: 'Period',
    estimatedPlayoffOdds: 'Estimated playoff odds',
    videoHook: 'My fantasy blueprint for this week 👇',
    oddsAreEstimates: 'Odds are estimates.',
    toughestDecision: 'What’s your toughest decision this week?',
    // commissionerWeekDraft
    leagueBriefing: 'League weekly briefing',
    sport: 'Sport',
    playoffScenarios: (week: number) => `Playoff scenarios are available for period ${week}. Review standings before naming qualification possibilities.`,
    rulesToReview: 'Rules or data to review',
    lineupDeadline: 'Official lineup deadline: [add the league’s time and timezone].',
    scoringCorrections: 'Scoring corrections and announcements: [add confirmed updates].',
    reviewBeforeLock: 'Review standings, rules and your team’s deadlines before lineup lock.',
    confirmBeforePublishing: 'Confirm official deadlines and add league announcements before publishing.',
    // drawWeeklyShareCard
    cardTitle: 'ALLFANTASY · YOUR WEEK',
    leagues: 'leagues',
    myPlanThisWeek: 'My plan for this week',
    myPlayoffPath: 'MY PLAYOFF PATH',
    estimateUnavailable: 'Estimate unavailable',
    estimate: 'Estimate',
    reviewStandingsRules: 'Review standings and rules.',
    oddsByResult: 'PLAYOFF ODDS BY RESULT · PERIOD',
    prepareNextDecision: 'PREPARE YOUR NEXT DECISION',
    ifIWin: 'If I win',
    ifILose: 'If I lose',
    compareOptions: 'Compare your options and check your league’s deadlines.',
    myNextPriority: 'MY NEXT PRIORITY',
    reviewMyTeam: 'Review my team and its rules',
    cardTagline: 'My week. My leagues. My next decision.',
    cardDisclaimer: 'Estimates, not guarantees. Imported history.',
    // buildWeeklyWorkbook (lib/core-app/weeklyWorkbook.ts): the Brief sheet's label cell
    workbookBriefLabel: 'Brief',
  },
  es: {
    record: (wins, losses, ties) => ` Serie importada: ${wins}-${losses}-${ties} (victorias-derrotas-empates).`,
    wonLast: (firstPerson, opponent, final) =>
      `${firstPerson ? 'Gané' : 'Ganaste'} el último encuentro importado contra ${opponent}.${final ? '' : ' ¡Vamos por dos seguidos!'}`,
    wonStreak: (firstPerson, opponent, streak, final) =>
      `En los encuentros importados anteriores a este período, ${firstPerson ? 'gané' : 'ganaste'} ${streak} veces seguidas contra ${opponent}.${final ? '' : ` ¡Vamos por ${streak + 1}!`}`,
    lostStreak: (opponent, streak, record) =>
      `En el historial importado, ${opponent} ganó los últimos ${streak} encuentros anteriores. Esta semana es una oportunidad para cambiar la historia.${record}`,
    series: (opponent, wins, losses, ties) =>
      `Historial importado contra ${opponent}: ${wins}-${losses}-${ties} (victorias-derrotas-empates).`,
    myFantasyWeek: 'Mi semana de fantasy',
    myPriority: 'Mi prioridad',
    period: 'Período',
    estimatedPlayoffOdds: 'Playoffs estimados',
    videoHook: 'Mi plan de fantasy para esta semana 👇',
    oddsAreEstimates: 'Las probabilidades son estimaciones.',
    toughestDecision: '¿Cuál es tu decisión más difícil esta semana?',
    leagueBriefing: 'Resumen semanal de la liga',
    sport: 'Deporte',
    playoffScenarios: (week) => `Hay escenarios de playoffs para el período ${week}. Revisa la clasificación antes de comentar quién puede clasificarse.`,
    rulesToReview: 'Reglas o datos pendientes de revisar',
    lineupDeadline: 'Plazo oficial de alineación: [añade el horario y la zona horaria de la liga].',
    scoringCorrections: 'Correcciones de puntuación y anuncios: [añade las novedades confirmadas].',
    reviewBeforeLock: 'Revisa la clasificación, las reglas y los plazos de tu equipo antes del bloqueo.',
    confirmBeforePublishing: 'Confirma los plazos oficiales y añade los anuncios de la liga antes de publicar.',
    cardTitle: 'ALLFANTASY · TU SEMANA',
    leagues: 'ligas',
    myPlanThisWeek: 'Mi plan para esta semana',
    myPlayoffPath: 'MI CAMINO A LOS PLAYOFFS',
    estimateUnavailable: 'Sin estimación',
    estimate: 'Estimación',
    reviewStandingsRules: 'Revisa la clasificación y las reglas.',
    oddsByResult: 'PLAYOFFS SEGÚN EL RESULTADO · PERÍODO',
    prepareNextDecision: 'PREPARA TU PRÓXIMA DECISIÓN',
    ifIWin: 'Si gano',
    ifILose: 'Si pierdo',
    compareOptions: 'Compara tus opciones y comprueba los plazos de tu liga.',
    myNextPriority: 'MI PRÓXIMA PRIORIDAD',
    reviewMyTeam: 'Revisar mi equipo y sus reglas',
    cardTagline: 'Mi semana. Mis ligas. Mi próxima decisión.',
    cardDisclaimer: 'Estimaciones, no garantías. Historial importado.',
    workbookBriefLabel: 'Resumen',
  },
})
