import { defineMessages } from '@/lib/i18n/messages'

/**
 * Matchup pulse board (components/core-app/MatchupPulseBoard.tsx). Every string is the one the board
 * printed before the move, byte for byte, in both languages — a relocation, not a rewrite.
 */
export const matchupPulseBoardMessages = defineMessages({
  en: {
    vs: (opponent: string) => `vs ${opponent}`,
    leftToPlay: (n: number) => `${n} left to play`,
    projFinal: (pm: string) => `proj final ${pm}`,
    howToRead: 'How to read this board',
    tipDone: 'Every game is final: Won and Lost are results, five shown on each side.',
    tipByOdds:
      'Favoured and Underdog sort your leagues by chance to win, five on each side — so a league you lead by 30 can sit under Underdog if the model expects it to turn.',
    tipByMargin: 'Leading and Trailing sort your leagues by margin, five on each side.',
    tipMargin: (anyProjected: boolean) =>
      `Each row’s number is your margin, with its own sign: + in green when you are ahead, − in red when behind. It is points scored${anyProjected ? ', or a projection where tagged PROJ.' : '.'} The bar under a row shows how big that margin is next to the others.`,
    tipRing:
      'The ring is your chance to win — absent on a finished game, or when the model can’t price both lineups. “proj final” on a live row is where the model expects it to end.',
    tipExpected: 'Expected record is your chances added up: 23.4–17.6 means you would expect to win about 23 of those matchups.',
    tipClosest: 'Closest games: the near coin-flips not already in the five on each side.',
    gapNotStarted: (n: number) => `${n} ${n === 1 ? 'has' : 'have'} not started yet`,
    gapElimination: (n: number) => `${n} ${n === 1 ? 'is a Guilly league' : 'are Guilly leagues'}, scored against the whole field`,
    gapScoringType: (n: number) =>
      `${n} ${n === 1 ? 'uses' : 'use'} category or roto scoring — points margins and odds are not available for this scoring type`,
    gapNoSchedule: (n: number) => `${n} carry no schedule`,
    gapNoOpponent: (n: number) => `${n} have no game this week`,
    gapUnpriceable: (n: number) => `${n} could not be scored or priced`,
    gapUncomparable: (n: number) => `${n} have lineups we cannot compare like for like`,
    gapUnidentified: (n: number) => `${n} carry a roster id we cannot match to a schedule — our gap, not theirs`,
    notRanked: (reasons: string) => `Not ranked: ${reasons}.`,
    oddsOf: (withOdds: number, decided: number) => `· across ${withOdds} of ${decided} matchups with odds`,
    oddsAll: (withOdds: number) => `· across ${withOdds} matchups with odds`,
    noneRankable: (n: number) =>
      `None of your ${n} claimed ${n === 1 ? 'team' : 'teams'} has a head-to-head we can rank this week — the line below says why.`,
    needsCount: (n: number, leagues: number) => `${n} across ${leagues} leagues`,
    quietRest: (_hidden: number): string => 'sit between the five shown on each side, have no game this week, or could not be scored.',
  },
  es: {
    vs: (opponent) => `contra ${opponent}`,
    leftToPlay: (n) => `${n} por jugar`,
    projFinal: (pm) => `final proy. ${pm}`,
    howToRead: 'Cómo leer este tablero',
    tipDone: 'Todos los partidos terminaron: Ganados y Perdidos son resultados, los cinco primeros de cada lado.',
    tipByOdds:
      'Favorito y En desventaja ordenan tus ligas por probabilidad de ganar, cinco de cada lado. Por eso una liga que ganas por 30 puede estar en En desventaja si el modelo espera que se dé vuelta.',
    tipByMargin: 'Ganando y Perdiendo ordenan tus ligas por margen, cinco de cada lado.',
    tipMargin: (anyProjected) =>
      `El número de cada fila es tu margen, con su propio signo: + en verde si vas arriba, − en rojo si vas abajo. Son puntos anotados${anyProjected ? ', o una proyección donde dice PROY.' : '.'} La barra bajo la fila muestra qué tan grande es ese margen frente a los demás.`,
    tipRing:
      'El anillo es tu probabilidad de ganar. No aparece en un partido terminado ni cuando el modelo no puede calcular ambas alineaciones. «final proy.» en una fila en vivo es dónde el modelo espera que termine.',
    tipExpected: 'El récord esperado es la suma de tus probabilidades: 23.4–17.6 significa que esperarías ganar unos 23 de esos enfrentamientos.',
    tipClosest: 'Partidos más reñidos: los casi empates que no están ya entre los cinco de cada lado.',
    gapNotStarted: (n) => `${n} aún sin comenzar`,
    gapElimination: (n) => `${n} de eliminación (Guilly), contra toda la liga`,
    gapScoringType: (n) =>
      `${n} con puntuación por categorías o rotisserie — los márgenes y las probabilidades por puntos no están disponibles para este tipo de puntuación`,
    gapNoSchedule: (n) => `${n} sin calendario`,
    gapNoOpponent: (n) => `${n} sin partido esta semana`,
    gapUnpriceable: (n) => `${n} sin puntuación o proyección`,
    gapUncomparable: (n) => `${n} con alineaciones no comparables`,
    gapUnidentified: (n) => `${n} con identificadores que no podemos vincular al calendario; es una limitación nuestra`,
    notRanked: (reasons) => `Sin clasificar: ${reasons}.`,
    oddsOf: (withOdds, decided) => `· en ${withOdds} de ${decided} enfrentamientos con probabilidades`,
    oddsAll: (withOdds) => `· de ${withOdds} enfrentamientos con probabilidades`,
    noneRankable: (n) =>
      n === 1
        ? 'Tu equipo asignado no tiene un enfrentamiento clasificable esta semana; abajo se explica por qué.'
        : `Ninguno de tus ${n} equipos asignados tiene un enfrentamiento clasificable esta semana; abajo se explica por qué.`,
    needsCount: (n, leagues) => `${n} en ${leagues} ligas`,
    quietRest: (hidden) =>
      hidden === 1
        ? 'está entre los cinco mostrados a cada lado, no juega esta semana o no se pudo puntuar.'
        : 'están entre los cinco mostrados a cada lado, no juegan esta semana o no se pudieron puntuar.',
  },
})
