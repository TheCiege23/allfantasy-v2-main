import { defineMessages } from '@/lib/i18n/messages'

/**
 * Small /core widgets that each carried a handful of inline English/Spanish ternaries:
 * FormatWeekCards, highlights/XPostEmbed, screens/DashUserOsView, screens/MyLeaguesV4,
 * standings/StandingsHistoryChart, comms/CommsDock, comms/CommsDrawer, WeekHistoryNotice and
 * WeekDateRange (all under components/core-app). Keys are prefixed by component. Every string is the
 * one the widget printed before the move, byte for byte, in both languages — this is a relocation,
 * not a rewrite.
 */
export const coreWidgetsMessages = defineMessages({
  en: {
    // FormatWeekCards
    formatWeekTitle: 'Your league goals',
    formatWeekPeriod: 'Period',
    formatWeekGoalCategories: 'Protect your categories; check minimums and caps.',
    formatWeekGoalRoto: 'Review your season category standings and targets.',
    formatWeekGoalSeasonPoints: 'Track your season points target.',
    formatWeekGoalElimination: 'Review survival rules.',
    formatWeekGoalHeadToHead: 'The schedule does not identify an opponent. Review or sync the league.',
    // highlights/XPostEmbed
    xPostLoad: 'Load X post',
    xPostLoading: 'Loading post…',
    xPostError: 'This post could not be displayed here.',
    xPostWatch: 'Watch on X',
    // screens/DashUserOsView
    userOsAria: 'Your team intelligence',
    userOsYourTeam: 'Your team',
    userOsOpenDecide: 'Open Decide',
    // screens/MyLeaguesV4
    myLeaguesDashboard: 'League dashboard',
    myLeaguesOpenHub: 'Open shared hub →',
    myLeaguesOpenLeague: 'Open League ↗',
    // standings/StandingsHistoryChart
    historyChartEmpty: (weeks: number) =>
      `The history starts once two weeks are final — there ${weeks === 1 ? 'is one' : 'are none'} so far.`,
    historyChartAria: (label: string, you: ReadonlyArray<{ week: number; value: number }> | null) =>
      `${you ? `Your ${label} by week: ${you.map((p) => `week ${p.week} ${p.value}`).join(', ')}. ` : ''}Every team's weekly ${label} is in the table below the chart.`,
    historyChartWeekAbbr: 'W',
    // comms/CommsDock
    commsDockTitle: 'Open chat · drag to move',
    commsDockMentions: (mentions: number, unread: number) =>
      `Open communications (${mentions} mention${mentions === 1 ? '' : 's'}, ${unread} unread)`,
    commsDockUnread: (unread: number) => `Open communications (${unread} unread)`,
    // comms/CommsDrawer
    commsDrawerClose: 'Close communications',
    commsDrawerGlobal: 'GLOBAL',
    commsDrawerChannels: 'Message channels',
    // WeekHistoryNotice
    weekHistoryBody:
      'Some league history or scoring-period data could not load. Available data is shown below; projections and rivalries may be incomplete.',
    weekHistoryRetry: 'Try again',
    // WeekDateRange
    weekRangeFallback: 'This week',
  },
  es: {
    formatWeekTitle: 'Los objetivos de tus ligas',
    formatWeekPeriod: 'Período',
    formatWeekGoalCategories: 'Protege tus categorías; revisa mínimos y límites.',
    formatWeekGoalRoto: 'Revisa tu posición y los objetivos de categorías de la temporada.',
    formatWeekGoalSeasonPoints: 'Persigue tu objetivo de puntos de la temporada.',
    formatWeekGoalElimination: 'Revisa las reglas de supervivencia.',
    formatWeekGoalHeadToHead: 'El calendario no identifica un rival. Revisa o sincroniza la liga.',
    xPostLoad: 'Cargar publicación de X',
    xPostLoading: 'Cargando publicación…',
    xPostError: 'Esta publicación no se puede mostrar aquí.',
    xPostWatch: 'Ver en X',
    userOsAria: 'Inteligencia de tu equipo',
    userOsYourTeam: 'Tu equipo',
    userOsOpenDecide: 'Abrir Decidir',
    myLeaguesDashboard: 'Panel de la liga',
    myLeaguesOpenHub: 'Abrir centro compartido →',
    myLeaguesOpenLeague: 'Abrir liga ↗',
    historyChartEmpty: (weeks) =>
      `El historial comienza cuando terminan dos semanas; hasta ahora ${weeks === 1 ? 'hay una' : 'no hay ninguna'}.`,
    historyChartAria: (label, you) =>
      `${you ? `Tu ${label} por semana: ${you.map((p) => `semana ${p.week} ${p.value}`).join(', ')}. ` : ''}La ${label} semanal de cada equipo aparece en la tabla debajo del gráfico.`,
    historyChartWeekAbbr: 'S',
    commsDockTitle: 'Abrir chat · arrastra para mover',
    commsDockMentions: (mentions, unread) => `Abrir chat (${mentions} menciones, ${unread} sin leer)`,
    commsDockUnread: (unread) => `Abrir chat (${unread} sin leer)`,
    commsDrawerClose: 'Cerrar mensajes',
    commsDrawerGlobal: 'TODAS LAS LIGAS',
    commsDrawerChannels: 'Canales de mensajes',
    weekHistoryBody:
      'Parte del historial o del período de tus ligas no se pudo cargar. Los datos disponibles aparecen abajo; las proyecciones y rivalidades pueden estar incompletas.',
    weekHistoryRetry: 'Intentar de nuevo',
    weekRangeFallback: 'Esta semana',
  },
})
