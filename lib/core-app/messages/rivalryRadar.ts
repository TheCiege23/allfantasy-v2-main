import { defineMessages } from '@/lib/i18n/messages'

/**
 * Rivalry Radar (components/core-app/screens/RivalryRadar.tsx). Every string is the one the screen
 * printed before the move, byte for byte, in both languages — this is a relocation, not a rewrite.
 * Strings still routed through `coreUiCopy` stay there; only the inline ternaries moved here.
 */
export const rivalryRadarMessages = defineMessages({
  en: {
    thisWeekFinal: 'This week · final',
    thisWeekLive: 'This week · live',
    projected: 'projected',
    subIntro: 'Every opponent you have played or play this week, read through every meeting we have on file — ',
    meetings: (n: number): string => (n === 1 ? 'completed matchup' : 'completed matchups'),
    across: 'across',
    seasons: (n: number): string => (n === 1 ? 'season' : 'seasons'),
    and: 'and',
    platforms: (n: number): string => (n === 1 ? 'platform' : 'platforms'),
    watchAllTime: 'all-time at an average margin of',
    watchProjectedWithin: ', and projected within ',
    watchToday: 'today.',
    preseasonBody: (kickoff: string) =>
      `Rivalries are read from scored weeks, and none have been played this season. Records build as weeks are scored — first kickoff ${kickoff}.`,
  },
  es: {
    thisWeekFinal: 'Esta semana · finalizado',
    thisWeekLive: 'Esta semana · en juego',
    projected: 'proyectados',
    subIntro: 'Cada rival al que te has enfrentado o te enfrentas esta semana, según nuestro historial: ',
    meetings: (n) => (n === 1 ? 'enfrentamiento' : 'enfrentamientos'),
    across: 'en',
    seasons: (n) => (n === 1 ? 'temporada' : 'temporadas'),
    and: 'y',
    platforms: (n) => (n === 1 ? 'plataforma' : 'plataformas'),
    watchAllTime: 'en el historial, con una diferencia media de',
    watchProjectedWithin: ', y una diferencia proyectada de ',
    watchToday: 'hoy.',
    preseasonBody: (kickoff) =>
      `Las rivalidades se basan en semanas puntuadas. Los historiales se formarán al avanzar la temporada; el primer partido comienza el ${kickoff}.`,
  },
})
