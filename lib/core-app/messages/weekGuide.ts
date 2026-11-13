import { defineMessages } from '@/lib/i18n/messages'

/**
 * The /core/week guide (components/core-app/week/WeekGuide.tsx, lib/core-app/weekGuide.ts).
 *
 * ⚠ SPANISH FOLLOWS THE APP'S WORDING RULINGS (__tests__/spanish-wording-rulings.test.tsx): a waiver
 * claim is «reclamo», the pool is «agentes libres», and no Spanish value says «waiver».
 */
export const weekGuideMessages = defineMessages({
  en: {
    eyebrow: (week: number | null, leagues: number) =>
      `${week != null ? `Week ${week} · ` : ''}${leagues} ${leagues === 1 ? 'league' : 'leagues'}`,
    headline: (winning: number, losing: number, close: number): string =>
      [`Winning ${winning}`, `losing ${losing}`, close > 0 ? `${close} too close to call` : null].filter(Boolean).join(' · '),
    noGamesYet: 'No head-to-head games to read yet this week',
    intro: 'Close games first — that’s where one lineup change can flip the result.',
    chipClose: 'Too close to call',
    chipSurvival: 'Lowest score right now',
    chipKickoff: 'First kickoff',
    chipNoGame: 'No game this week',
    why: 'Why it matters',

    closeTitle: 'Too close to call',
    closeSub: '40–60% to win',
    closeNone: 'No game this week is close enough to swing on one decision.',
    vs: (opponent: string) => `vs ${opponent}`,
    aheadSoFar: (pts: string) => `Ahead by ${pts} so far`,
    behindSoFar: (pts: string) => `Behind by ${pts} so far`,
    tiedSoFar: 'Tied so far',
    projected: (you: string, them: string) => `Projected ${you}–${them}`,
    toWin: (pct: number) => `${pct}% to win`,
    openGame: 'Open game',
    closeMore: (n: number) => `+${n} more close games in the full list`,
    closeTeach:
      'A heavy favourite rarely loses to one bad start. A coin flip often does — this is where a lineup change, a bench swap or a free-agent pickup actually pays off.',

    survivalTitle: 'Survival leagues',
    survivalSub: 'No opponent — the lowest score each week is eliminated.',
    survivalLowest: 'Lowest score right now',
    survivalAbove: (pts: string) => `${pts} above the lowest score`,
    survivalNotStarted: 'No scores in yet',
    survivalTeach:
      'You don’t need to win, only to not finish last. Watch the gap above the lowest score, not your total — a small lead late in the week is a real risk.',

    kickTitle: 'When your starters play',
    kickSub: 'Next game for your stored starters, grouped by kickoff.',
    kickLeagues: (n: number) => `${n} ${n === 1 ? 'league' : 'leagues'}`,
    kickMore: (n: number) => `+${n} later kickoffs`,
    kickNone: 'No starter games found in the next 7 days.',
    otherDeadlines: 'Other deadlines',
    kickTeach:
      'A player locks when their game starts, unless your league locks the whole lineup at once. Make changes before the first kickoff that involves them.',

    runTitle: 'Leagues you run this week',
    runBody: 'Check inactive managers, empty lineups and trades waiting on you before kickoff.',
    runOpen: 'Open Commissioner Hub',

    boardTitle: 'Every game this week',
    boardSub: '“So far” is real points on the board. Before kickoff it’s a projection from each team’s past weeks.',
    howProjections: 'How projections work',
    boardQuiet: 'aren’t in the lists above.',
    toolsTitle: 'Plan, calendar and sharing tools',
    toolsSub: 'Ask Chimmy, copy your brief, plans by sport, the full 7-day calendar with a calendar download, and sharing.',
  },
  es: {
    eyebrow: (week, leagues) => `${week != null ? `Semana ${week} · ` : ''}${leagues} ${leagues === 1 ? 'liga' : 'ligas'}`,
    headline: (winning, losing, close) =>
      [`Ganando ${winning}`, `perdiendo ${losing}`, close > 0 ? `${close} muy parejos` : null].filter(Boolean).join(' · '),
    noGamesYet: 'Todavía no hay enfrentamientos que leer esta semana',
    intro: 'Primero los partidos parejos: ahí un cambio de alineación puede cambiar el resultado.',
    chipClose: 'Muy parejos',
    chipSurvival: 'Puntuación más baja ahora',
    chipKickoff: 'Primer partido',
    chipNoGame: 'Sin partido esta semana',
    why: 'Por qué importa',

    closeTitle: 'Muy parejos',
    closeSub: '40–60 % de ganar',
    closeNone: 'Ningún partido de esta semana está tan parejo como para decidirse por una sola decisión.',
    vs: (opponent) => `contra ${opponent}`,
    aheadSoFar: (pts) => `Ganando por ${pts} hasta ahora`,
    behindSoFar: (pts) => `Perdiendo por ${pts} hasta ahora`,
    tiedSoFar: 'Empatados hasta ahora',
    projected: (you, them) => `Proyección ${you}–${them}`,
    toWin: (pct) => `${pct} % de ganar`,
    openGame: 'Abrir partido',
    closeMore: (n) => `+${n} partidos parejos más en la lista completa`,
    closeTeach:
      'Un gran favorito casi nunca pierde por un mal titular. Un partido parejo sí: aquí es donde un cambio de alineación, de banca o un agente libre de verdad marca la diferencia.',

    survivalTitle: 'Ligas de supervivencia',
    survivalSub: 'Sin rival: cada semana se elimina la puntuación más baja.',
    survivalLowest: 'Puntuación más baja ahora',
    survivalAbove: (pts) => `${pts} por encima de la más baja`,
    survivalNotStarted: 'Todavía sin puntos',
    survivalTeach:
      'No necesitas ganar, solo no quedar último. Mira la distancia sobre la puntuación más baja, no tu total: una ventaja pequeña al final de la semana es un riesgo real.',

    kickTitle: 'Cuándo juegan tus titulares',
    kickSub: 'Próximo partido de tus titulares guardados, agrupado por hora de inicio.',
    kickLeagues: (n) => `${n} ${n === 1 ? 'liga' : 'ligas'}`,
    kickMore: (n) => `+${n} inicios más tarde`,
    kickNone: 'No hay partidos de tus titulares en los próximos 7 días.',
    otherDeadlines: 'Otras fechas límite',
    kickTeach:
      'Un jugador se bloquea cuando empieza su partido, salvo que tu liga bloquee toda la alineación a la vez. Haz los cambios antes del primer partido que le afecte.',

    runTitle: 'Ligas que diriges esta semana',
    runBody: 'Revisa mánagers inactivos, alineaciones vacías e intercambios pendientes antes del inicio.',
    runOpen: 'Abrir el Centro del Comisionado',

    boardTitle: 'Todos los partidos de esta semana',
    boardSub: '«Hasta ahora» son puntos reales. Antes del inicio es una proyección a partir de las semanas anteriores de cada equipo.',
    howProjections: 'Cómo funcionan las proyecciones',
    boardQuiet: 'no están en las listas de arriba.',
    toolsTitle: 'Plan, calendario y herramientas para compartir',
    toolsSub: 'Pregunta a Chimmy, copia tu resumen, planes por deporte, el calendario completo de 7 días con descarga y opciones para compartir.',
  },
})
