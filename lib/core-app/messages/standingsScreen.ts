import { defineMessages } from '@/lib/i18n/messages'

/**
 * Standings (components/core-app/screens/Standings.tsx), its board
 * (components/core-app/standings/StandingsBoardView.tsx) and the board's points charts
 * (components/core-app/standings/StandingsPointsChart.tsx, `standingsChartsMessages`).
 * Every string is the one the component wrote before the move, byte for byte, in both languages — a
 * relocation, not a rewrite. Imports nothing at runtime.
 *
 * ⚠ ENGLISH ORDINALS ARE PASSED IN, NOT REBUILT HERE. Both components already own an `ordinal()`; a
 * message that prints one takes the number (for Spanish, which writes "3.º") and the component's
 * English ordinal (for English), so there is still exactly one ordinal rule per file.
 */

/** One week's place in the table, as the rank-bars chart reads it. */
type RankPoint = { week: number; rank: number }

/** The four facts behind a power-ranking comparison; scores and records arrive already formatted. */
type PowerWhy = {
  up: string
  low: string
  upScore: string
  lowScore: string
  upAllPlay: string
  lowAllPlay: string
  upPoints: string
  lowPoints: string
  /** The raw scores differ (compared before formatting, so 10.04 and 10.01 still differ). */
  scoresDiffer: boolean
  weighted: boolean
}

export const standingsScreenMessages = defineMessages({
  en: {
    // ── lineText ──
    gamesUnit: (abs: number): string => (abs === 1 ? 'game' : 'games'),
    gamesClearOfLine: (games: string) => `${games} clear of the line`,
    gamesBehindLine: (games: string) => `${games} behind the line`,
    // ── pathSentence ──
    pathByeClinched: 'Your first-round bye is clinched.',
    pathPlayoffClinched: 'Your playoff spot is clinched.',
    pathEliminated: 'You are eliminated from the playoff race.',
    pathWinOutNotEnough: 'Winning out does not guarantee a spot on its own yet — you need results elsewhere too',
    pathWinOutAll: (gamesLeft: number) => `Win out — all ${gamesLeft} — and you are in, whatever else happens`,
    pathWinSome: (w: number, gamesLeft: number) => `Win ${w} of your last ${gamesLeft} and you are in, whatever else happens`,
    pathLoseMore: (l: number) => `lose ${l} more and you are out`,
    // ── WeekStakes ──
    unknownTeam: 'Unknown team',
    stakesTitle: 'What is at stake',
    playoffOdds: 'playoff odds',
    seasonOutlook: 'Season Outlook',
    stakesInProgress: (week: number, opponent: string) =>
      `Week ${week} against ${opponent} is still being played; it is not counted above yet.`,
    yourGameWeek: (week: number) => `Your game · week ${week}`,
    stakesWin: 'Win',
    stakesLose: 'Lose',
    stakesClinchOnWin: 'Win and you are in, in essentially every simulated season.',
    stakesHelpIfLose: (names: string[]): string => `If you lose, you most need ${names.join(' and ')} to miss the playoffs.`,
    rootForWeek: (week: number) => `Root for · week ${week}`,
    rootOver: ' over ',
    rootForYouAgainst: ' for you, against ',
    rootNoGameMoves: 'No other game that week moves your odds by more than a few points either way.',
    stakesBasis:
      'Win and lose are your playoff odds with that result fixed; each rooting pair is your odds in the simulated seasons where that team won. All of it is Season Outlook’s simulation, seeded so it reads the same on every visit.',
    // ── SeasonHistory ──
    historyNote: (seasons: number) => `Imported final standings. ${seasons} ${seasons === 1 ? 'season' : 'seasons'} on file.`,
    historyTableLabel: (season: number) => `${season} final standings`,
    // ── Standings ──
    subtitle: (p: { platform: string; season: number; seasonComplete: boolean; week: number; throughWeek: number }) =>
      `${p.platform === 'the platform' ? 'The league table' : `${p.platform}’s table`}, and AllFantasy’s own power ranking beside it — record decides the seeding, all-play says who is actually good. ${p.season} · ${p.seasonComplete ? `season complete after week ${p.week}` : `results through week ${p.throughWeek}`}.`,
    /** `ord` is the component's English ordinal of `n`. */
    seedPlace: (n: number, ord: string): string => ord,
    pfRankInLeague: (n: number, ord: string) => `${ord} in the league`,
    trendNeedsTwoWeeks: (finalWeeks: number) =>
      `A trend needs at least two final weeks. There ${finalWeeks === 1 ? 'is one' : 'are none'} so far.`,
    rankInPoints: (n: number, ord: string) => `${ord} in points`,
    // ── RankBars ──
    barsLabel: (trend: RankPoint[], ordinal: (n: number) => string) =>
      `Place in the table by week: ${trend.map((p) => `week ${p.week} ${ordinal(p.rank)}`).join(', ')}`,
    barsWeekPrefix: 'W',
    barsCaption: (best: number, now: number, ordinal: (n: number) => string) =>
      `Taller bar = better rank. Best ${ordinal(best)} · now ${ordinal(now)}. Positions only move on final results, never estimated between weeks.`,
  },
  es: {
    gamesUnit: (abs) => (abs === 1 ? 'partido' : 'partidos'),
    gamesClearOfLine: (games) => `${games} por encima del límite`,
    gamesBehindLine: (games) => `${games} por debajo del límite`,
    pathByeClinched: 'Tu descanso de primera ronda está asegurado.',
    pathPlayoffClinched: 'Tu plaza de playoffs está asegurada.',
    pathEliminated: 'Estás eliminado de la carrera por los playoffs.',
    pathWinOutNotEnough: 'Ganarlo todo todavía no asegura plaza por sí solo: también necesitas resultados de otros partidos',
    pathWinOutAll: (gamesLeft) => `Gánalo todo (los ${gamesLeft}) y estás dentro, pase lo que pase`,
    pathWinSome: (w, gamesLeft) => `Gana ${w} de tus últimos ${gamesLeft} y estás dentro, pase lo que pase`,
    pathLoseMore: (l) => `${l === 1 ? 'pierde 1 más y quedas fuera' : `pierde ${l} más y quedas fuera`}`,
    unknownTeam: 'Equipo desconocido',
    stakesTitle: 'Qué está en juego',
    playoffOdds: 'probabilidad de playoffs',
    seasonOutlook: 'Proyección de temporada',
    stakesInProgress: (week, opponent) => `La semana ${week} contra ${opponent} aún se está jugando; todavía no cuenta arriba.`,
    yourGameWeek: (week) => `Tu partido · semana ${week}`,
    stakesWin: 'Si ganas',
    stakesLose: 'Si pierdes',
    stakesClinchOnWin: 'Si ganas, estás dentro en prácticamente todas las temporadas simuladas.',
    stakesHelpIfLose: (names) =>
      `Si pierdes, lo que más necesitas es que ${names.join(' y ')} se ${names.length === 1 ? 'quede' : 'queden'} fuera de playoffs.`,
    rootForWeek: (week) => `Apoya a · semana ${week}`,
    rootOver: ' sobre ',
    rootForYouAgainst: ' para ti, frente a ',
    rootNoGameMoves: 'Ningún otro partido de esa semana mueve tus probabilidades más de unos pocos puntos en ningún sentido.',
    stakesBasis:
      'Ganar y perder son tus probabilidades de playoffs con ese resultado fijado; cada pareja a la que apoyar son tus probabilidades en las temporadas simuladas donde ganó ese equipo. Todo sale de la simulación de Proyección de temporada, con una semilla fija para que se lea igual en cada visita.',
    historyNote: (seasons) =>
      `Clasificaciones finales importadas. ${seasons} ${seasons === 1 ? 'temporada registrada' : 'temporadas registradas'}.`,
    historyTableLabel: (season) => `Clasificación final de ${season}`,
    subtitle: (p) =>
      `${p.platform === 'the platform' ? 'Tabla de la liga' : `Tabla de ${p.platform}`} y clasificación de rendimiento de AllFantasy. El récord determina los puestos de playoffs; el rendimiento contra todos muestra la fuerza de cada equipo. ${p.season} · ${p.seasonComplete ? `temporada terminada tras la semana ${p.week}` : `resultados hasta la semana ${p.throughWeek}`}.`,
    seedPlace: (n) => `${n}.º`,
    pfRankInLeague: (n) => `${n} de la liga`,
    trendNeedsTwoWeeks: (finalWeeks) =>
      `La tendencia necesita al menos dos semanas cerradas. Hasta ahora ${finalWeeks === 1 ? 'hay una' : 'no hay ninguna'}.`,
    rankInPoints: (n) => `${n} en puntos`,
    barsLabel: (trend) => `Posición en la tabla por semana: ${trend.map((p) => `semana ${p.week} puesto ${p.rank}`).join(', ')}`,
    barsWeekPrefix: 'S',
    barsCaption: (best, now) =>
      `Una barra más alta indica mejor posición. Mejor: ${best}; ahora: ${now}. Las posiciones solo cambian con resultados finales.`,
  },
})

export const standingsBoardMessages = defineMessages({
  en: {
    // ── 2026-11 redesign: Diff and AF columns, the playoff picture ──
    diffAbbrev: 'Diff',
    diffTitle: 'Points for minus points against',
    powerColAbbrev: 'AF',
    powerColTitle: 'AllFantasy power rank, and its move since last week',
    playoffPicture: 'Playoff picture',
    pictureNote: (assumed: boolean) =>
      `The field if the season ended today, from the table above.${assumed ? ' This league does not publish its playoff size, so the field is the usual one for its platform.' : ''} First-round pairings are the league’s to set, so they are not drawn.`,
    byeSeeds: (byes: number) => (byes === 1 ? 'First-round bye' : `First-round byes · top ${byes}`),
    playingRoundOne: 'Playing the first round',
    seedLabel: (seed: number) => `Seed ${seed}`,
    raceTitle: 'Race for the last spot',
    raceHolding: 'Holding it',
    raceChasing: 'Chasing',
    raceGamesBack: (gb: string) => `${gb} back`,
    raceLevel: 'level, out on the tiebreak',
    raceOdds: 'playoff odds',
    raceNone: 'Nobody is still chasing the last spot.',
    // ── Form / StreakCell ──
    formLabel: (form: readonly string[]) => `Last ${form.length}: ${form.join(' ')}`,
    /** W/L/T, as the Last 5 column prints it. */
    resultLetter: (r: string): string => r,
    // ── sosTitle / SosCell ──
    sosNoneLeft: 'No modelled opponents left to rank',
    sosAverages: (opponents: string, league: string) => ` Opponents left average ${opponents} a week; the league averages ${league}.`,
    sosTitle: (rank: number, ord: string, of: number, avg: string) => `${ord}-hardest remaining schedule of ${of}.${avg}`,
    /** `ord` is the component's English ordinal of `n`. */
    rankPlace: (n: number, ord: string): string => ord,
    hardestOf: (of: number) => `hardest of ${of}`,
    // ── NextCell ──
    weekAbbrev: 'Wk',
    // ── SortTh ──
    /** `label` is the English column name; `localized` is the same name through coreUiCopy. */
    sortLabel: (label: string, localized: string, nextDir: 'asc' | 'desc') =>
      `${label}: sort ${nextDir === 'asc' ? 'ascending' : 'descending'}`,
    // ── the table ──
    winLossAbbrev: 'W-L',
    gamesBackTitle: (field: number, ord: string) => `Games behind the last playoff spot (${ord}); + means ahead of it`,
    // ── lineLabel ──
    byeLine: (byes: number) => `First-round bye line — top ${byes}`,
    playoffLine: (field: number, assumed: boolean) =>
      `Playoff line — top ${field} make it${assumed ? ' (assumed: the league does not report its playoff size)' : ''}`,
    // ── phone cards ──
    projectedFinish: (record: string, seed: number, ord: string) => `Projected finish ${record}, ${ord} — an expectation, not a result.`,
    // ── HeadToHeadGrid ──
    h2hIntro: (medianGames: boolean) =>
      `Read across: each row’s record against the team in that column. Head-to-head games only${medianGames ? ' — median games have no opponent' : ''}.`,
    h2hAgainst: (name: string) => ` against ${name}`,
    h2hNotPlayed: (name: string) => ` — has not played ${name}`,
    // ── WhyAbove ──
    powerWhy: (p: PowerWhy): string =>
      p.scoresDiffer
        ? `${p.up} scores ${p.upScore} to ${p.lowScore}: all-play ${p.upAllPlay} against ${p.lowAllPlay}${p.weighted ? ', with the last three weeks weighted' : ''}.`
        : `${p.up} and ${p.low} have the same power score; ${p.up} is ahead on points for (${p.upPoints} to ${p.lowPoints}).`,
    /** `reason` is the language's own explanation (explainOrder / spanishOrderReason). */
    officialWhy: (p: { up: string; low: string; upSeed: number; lowSeed: number; upOrd: string; lowOrd: string; reason: string }) =>
      `${p.up} is ${p.upOrd}, ${p.low} ${p.lowOrd}. ${p.reason}`,
    // ── the kind note and "How this table works" ──
    platformTable: (platform: string) => `${platform}’s table.`,
    howTitle: 'How this table works',
    howPlayoffs: (p: { fromLeague: boolean; field: number; byes: number }) =>
      `${p.fromLeague ? `Top ${p.field} make the playoffs, per the league's settings${p.byes > 0 ? `; the top ${p.byes} get a first-round bye` : ''}.` : `The league does not report its playoff size, so the line assumes ${p.field}.`} Clinched and eliminated are certainties: a level record counts against the team, because a points tiebreak can still move.`,
    /** The magic-numbers note, cut around its two <strong> letters (C, then E). */
    magicLead: 'Magic numbers: ',
    magicMid: ' is how many more wins guarantee a playoff spot, ',
    magicTail: ' how many more losses end the chase — each whatever every other game does, so help from elsewhere can only lower them.',
    /** The odds note, cut around its Season Outlook link. */
    oddsLead: 'Playoff % and schedule strength come from',
    oddsLink: 'Season Outlook',
    oddsTail: (runs: string) =>
      `’s simulation of the rest of the season (${runs} runs), which seeds on wins then points for. “In” and “Out” are printed only where this table’s own arithmetic has settled it.`,
    luckNote: (medianGames: boolean) =>
      `Expected wins count, each week, the share of the league a team outscored. Luck is actual head-to-head wins minus expected wins${medianGames ? ' (median games are not part of it)' : ''}.`,
    /** The odds note's run count. */
    numberLocale: 'en-US',
    /**
     * Why one team sits above another. The English is the model's own `explainOrder` sentence; a
     * language that rebuilds it is handed the component's builder (called only for that language) and
     * falls back to the English where the builder has nothing.
     */
    orderReason: (english: string, _rebuild: () => string): string => english,
    tiebreak: (english: string, _rebuild: () => string | null): string => english,
  },
  es: {
    diffAbbrev: 'Dif.',
    diffTitle: 'Puntos a favor menos puntos en contra',
    powerColAbbrev: 'AF',
    powerColTitle: 'Posición en el ranking de poder de AllFantasy y su cambio desde la semana pasada',
    playoffPicture: 'Panorama de playoffs',
    pictureNote: (assumed) =>
      `Los clasificados si la temporada terminara hoy, según la tabla de arriba.${assumed ? ' Esta liga no publica cuántos equipos van a playoffs, así que se usa lo habitual en su plataforma.' : ''} Los cruces de la primera ronda los define la liga, así que no se dibujan.`,
    byeSeeds: (byes) => (byes === 1 ? 'Descanso en primera ronda' : `Descanso en primera ronda · los primeros ${byes}`),
    playingRoundOne: 'Juegan la primera ronda',
    seedLabel: (seed) => `Puesto ${seed}`,
    raceTitle: 'La pelea por el último puesto',
    raceHolding: 'Lo ocupa',
    raceChasing: 'Lo persiguen',
    raceGamesBack: (gb) => `a ${gb}`,
    raceLevel: 'empatado, fuera por el desempate',
    raceOdds: 'probabilidad de playoffs',
    raceNone: 'Nadie persigue ya el último puesto.',
    formLabel: (form) => `Últimos ${form.length}: ${form.map((r) => r === 'W' ? 'victoria' : r === 'L' ? 'derrota' : 'empate').join(', ')}`,
    resultLetter: (r) => (r === 'W' ? 'G' : r === 'L' ? 'P' : 'E'),
    sosNoneLeft: 'No quedan rivales modelados que clasificar',
    sosAverages: (opponents, league) => ` Los rivales restantes promedian ${opponents} por semana; la liga promedia ${league}.`,
    sosTitle: (rank, ord, of, avg) => `${rank}.º calendario restante más difícil de ${of}.${avg}`,
    rankPlace: (n) => `${n}.º`,
    hardestOf: (of) => `más difícil de ${of}`,
    weekAbbrev: 'Sem',
    sortLabel: (label, localized, nextDir) => `${localized}: ordenar ${nextDir === 'asc' ? 'ascendente' : 'descendente'}`,
    winLossAbbrev: 'G-P',
    gamesBackTitle: (field) => `Partidos detrás del último puesto de playoffs (${field}); + indica ventaja`,
    byeLine: (byes) => `Línea de descanso en primera ronda: los primeros ${byes}`,
    playoffLine: (field, assumed) =>
      `Línea de playoffs: clasifican los primeros ${field}${assumed ? ' (estimado: la liga no publica cuántos equipos clasifican)' : ''}`,
    projectedFinish: (record, seed) => `Resultado proyectado ${record}, puesto ${seed}; una estimación, no un resultado.`,
    h2hIntro: (medianGames) =>
      `Lee cada fila de izquierda a derecha: el récord de ese equipo contra el de cada columna. Solo partidos cara a cara${medianGames ? '; los partidos contra la mediana no tienen rival' : ''}.`,
    h2hAgainst: (name) => ` contra ${name}`,
    h2hNotPlayed: (name) => ` — no ha jugado contra ${name}`,
    powerWhy: (p) =>
      p.scoresDiffer
        ? `${p.up} tiene ${p.upScore} puntos de rendimiento frente a ${p.lowScore} de ${p.low}: récord contra todos ${p.upAllPlay} frente a ${p.lowAllPlay}${p.weighted ? ', con más peso para las últimas tres semanas' : ''}.`
        : `${p.up} y ${p.low} tienen la misma puntuación de rendimiento; ${p.up} va delante por puntos a favor (${p.upPoints} frente a ${p.lowPoints}).`,
    officialWhy: (p) => `${p.up} ocupa el puesto ${p.upSeed} y ${p.low} el ${p.lowSeed}. ${p.reason}`,
    platformTable: (platform) => `Tabla de ${platform}.`,
    howTitle: 'Cómo funciona esta tabla',
    howPlayoffs: (p) =>
      `${p.fromLeague ? `Según las reglas de la liga, clasifican los primeros ${p.field}${p.byes > 0 ? ` y los primeros ${p.byes} descansan en la primera ronda` : ''}.` : `La liga no publica cuántos equipos clasifican; la línea supone ${p.field}.`} Clasificado y eliminado son estados seguros: un récord empatado cuenta contra el equipo porque los puntos de desempate aún pueden cambiar.`,
    magicLead: 'Números mágicos: ',
    magicMid: ' son las victorias que faltan para asegurar plaza de playoffs y ',
    magicTail: ' las derrotas que acaban con las opciones, pase lo que pase en los demás partidos; la ayuda de otros resultados solo puede bajarlos.',
    oddsLead: 'El % de playoffs y la dificultad del calendario vienen de la simulación del resto de la temporada de',
    oddsLink: 'Proyección de temporada',
    oddsTail: (runs) =>
      ` (${runs} simulaciones), que ordena por victorias y luego por puntos a favor. «Dentro» y «Fuera» solo aparecen cuando la propia aritmética de esta tabla lo ha decidido.`,
    luckNote: (medianGames) =>
      `Las victorias esperadas miden, cada semana, a qué parte de la liga superó un equipo. La suerte es la diferencia entre las victorias reales y las esperadas${medianGames ? '; no incluye partidos contra la mediana' : ''}.`,
    numberLocale: 'es-ES',
    orderReason: (_english, rebuild) => rebuild(),
    tiebreak: (english, rebuild) => rebuild() ?? english,
  },
})

/**
 * The points picture (components/core-app/standings/StandingsPointsChart.tsx) — the chart descriptions
 * it read out per language. Same rule as above: a relocation, byte for byte. Points, expected wins and
 * all-play records arrive already formatted by the component.
 */
export const standingsChartsMessages = defineMessages({
  en: {
    /** `rows` is every team's `pointAria`, already joined with '; '. */
    scatterAria: (count: number, rows: string) => `Points for against points against for ${count} teams. ${rows}.`,
    pointAria: (name: string, pointsFor: string, pointsAgainst: string) =>
      `${name}: ${pointsFor} for, ${pointsAgainst} against`,
    winsAria: (name: string, actual: number, expected: string, allPlay: string) =>
      `${name}: ${actual} wins, ${expected} expected, all-play ${allPlay}`,
    winsTitle: (name: string, actual: number, expected: string, allPlay: string) =>
      `${name}: ${actual} wins vs ${expected} expected (all-play ${allPlay})`,
  },
  es: {
    scatterAria: (count, rows) => `Puntos a favor y en contra de ${count} equipos. ${rows}.`,
    pointAria: (name, pointsFor, pointsAgainst) => `${name}: ${pointsFor} a favor, ${pointsAgainst} en contra`,
    winsAria: (name, actual, expected, allPlay) =>
      `${name}: ${actual} victorias, ${expected} esperadas, contra todos ${allPlay}`,
    winsTitle: (name, actual, expected, allPlay) =>
      `${name}: ${actual} victorias frente a ${expected} esperadas (contra todos ${allPlay})`,
  },
})
