import { ordinal, pct } from '@/lib/core-app/outlookCopy'
import { ordinalEs } from '@/lib/core-app/outlookSpanish'
import { defineMessages } from '@/lib/i18n/messages'

/**
 * Season Outlook, one league (components/core-app/screens/SeasonOutlookLeague.tsx). Every string is
 * the one the screen printed before the move, byte for byte, in both languages — this is a
 * relocation, not a rewrite. The loader's sentences still go through `outlookText` /
 * `seasonOutlookSentence`; only the screen's own fixed copy lives here.
 */
/** "under 1%", "over 99%", "52%": the headline says a probability in words, never "<1%". */
const pctWords = (n: number) => {
  const p = pct(n)
  return p === '<1' ? 'under 1%' : p === '>99' ? 'over 99%' : `${p}%`
}
const pctWordsEs = (n: number) => {
  const p = pct(n)
  return p === '<1' ? 'menos del 1%' : p === '>99' ? 'más del 99%' : `un ${p}%`
}

export const seasonOutlookLeagueMessages = defineMessages({
  en: {
    tabPath: 'Path to playoffs',
    tabWhatif: 'What-if',
    tabMoves: 'Moves',
    tabTeams: 'All teams',
    /** Section headings inside the four tabs (2026-11-14: Roster risk moved under Moves, Schedule under All teams). */
    rosterRisk: 'Roster risk',
    scheduleStrength: 'Schedule strength',
    /** The fold that replaced the Assumptions tab. */
    howWorkedOut: 'How these odds are worked out',
    /**
     * The answer, as the page's h1 (2026-11-14). The title used to be "Season Outlook", and the answer was
     * five boxes down. The bands match how a person would say it; the number is always in it.
     */
    headline: (status: 'clinched' | 'eliminated' | null, playoffPct: number): string =>
      status === 'clinched'
        ? 'You’re in the playoffs'
        : status === 'eliminated'
          ? 'You’re out of the playoff race'
          : playoffPct >= 90
            ? `Very likely in: ${pctWords(playoffPct)} to make the playoffs`
            : playoffPct >= 60
              ? `Likely in: ${pctWords(playoffPct)} to make the playoffs`
              : playoffPct >= 40
                ? `A coin flip: ${pctWords(playoffPct)} to make the playoffs`
                : playoffPct >= 10
                  ? `An outside chance: ${pctWords(playoffPct)} to make the playoffs`
                  : `A long shot: ${pctWords(playoffPct)} to make the playoffs`,
    noTeamTitle: 'We cannot tell which team is yours in this league.',
    noTeamBody:
      "Every number on this screen is about your position in the field, so none of it can be shown until the roster is matched to your account. The league's own standings are still below.",
    forecastHeading: (seed: number) => `Your forecast · ${ordinal(seed)} seed`,
    clearOfCut: (games: number) => `${games} clear of the cut · `,
    levelWithCut: 'level with the cut · ',
    backOfCut: (games: number) => `${games} back of the cut · `,
    regularSeasonOver: 'regular season over',
    toPlay: (weeks: number) => `${weeks} to play`,
    playoffsLabel: 'Playoffs',
    vsOpponent: (name: string) => ` · vs ${name}`,
    playoffsSub: (playoffTeams: number, teamCount: number) => `top ${playoffTeams} of ${teamCount}`,
    byeLabel: 'First-round bye',
    byeSub: (byeTeams: number) => `top ${byeTeams} seed${byeTeams === 1 ? '' : 's'}`,
    title: 'Title',
    titleSub: 'win the bracket',
    nextAction: 'Next action',
    playoffPts: 'playoff odds',
    setLineup: 'Set your lineup',
    openWaivers: 'Open waivers',
    winWeek: (week: number) => `Win week ${week}`,
    againstOpponent: (opponentName: string) => ` against ${opponentName}`,
    worthPrefix: 'It is worth ',
    swingOdds: (ifWin: string, ifLose: string) => ` of playoff odds — ${ifWin}% with a win, ${ifLose}% with a loss.`,
    openThatMatchup: 'Open that matchup',
    nothingHereElsewhere: (leagueName: string) => `Nothing here needs you — ${leagueName} does.`,
    open: 'Open',
    nothingNeedsDecision: 'Nothing in this league needs a decision right now.',
    whatMovesSeason: 'What moves your season most',
    driversLater: 'Drivers are worked out when this league is open on its own.',
    driversNote: 'How much each one changes your playoff odds, compared with an average team.',
    tabsAria: 'Season Outlook detail',
    tooFewWeeks: 'Your team has too few completed weeks to project a record.',
    whatIfsUnavailable: 'What-ifs could not be prepared for this league just now.',
    recommendedMoves: 'Recommended moves',
    movesUnavailable: 'Moves could not be prepared for this league just now.',
    movesNote: (iterations: number | null) =>
      `Each move is simulated against the same season with and without it${
        iterations != null ? `, ${iterations.toLocaleString('en-US')} times each` : ''
      }. Trades are not suggested here — try one in What-if.`,
    everyFactor: 'Every factor we measured',
    rosterRiskUnavailable: 'Roster risk could not be read for this league.',
    whereAttention: 'Where to spend your attention',
    attentionNote: 'your other leagues, most urgent first',
    seasonOutlookTitle: 'Season Outlook',
    seasonOutlookSub: 'Your chances of making the playoffs and winning the title, from simulated seasons of this league.',
    howYouClinch: 'How you clinch',
    seasonOverClinch: 'The regular season is over in this league — there is nothing left to clinch.',
    noNextGame: 'We could not find your next unplayed game in this league, so there is no single result to branch on.',
    week: 'Week',
    ifYouWin: 'If you win',
    clinchOnWin: 'You are in. Win this and the rest is about seeding.',
    notDecided: 'Still not decided, but this is the single biggest move available to you.',
    ifYouLose: 'If you lose',
    noSingleRescue: 'No single other result rescues this — you would need the run of play to go your way across several games, not one.',
    needOne: (team: string) => `You would need ${team} to miss out too. That one absence lifts your odds more than any other result on the board.`,
    needTwo: (a: string, b: string) =>
      `You would need ${a} or ${b} to miss out too — those two absences move your number more than anything else you do not control.`,
    standingsCaption: (leagueName: string) =>
      `Every team in ${leagueName}, ordered by current seed. The line marks the playoff cut. Hover a playoff figure for its range.`,
    team: 'Team',
    record: 'Record',
    pointsFor: 'Points for',
    bye: 'Bye',
    whatDecides: 'What decides it',
    unnamedTeam: 'Unnamed team',
    you: 'You',
    range: 'Range',
    historyTitle: 'How your odds moved',
    historyWeek: (week: number) => `Week ${week}`,
    historyWeekShort: (week: number) => `W${week}`,
    historyAria: (from: number, to: number) => `Your playoff and title odds by week, week ${from} to week ${to}`,
    historyNote: 'Your simulated odds as each week stood, from the same runs as the numbers above.',
    historyTable: 'Show the numbers',
  },
  es: {
    tabPath: 'Camino a playoffs',
    tabWhatif: 'Escenarios',
    tabMoves: 'Movimientos',
    tabTeams: 'Todos los equipos',
    rosterRisk: 'Riesgo de plantilla',
    scheduleStrength: 'Dificultad del calendario',
    howWorkedOut: 'Cómo se calculan estas probabilidades',
    headline: (status, playoffPct) =>
      status === 'clinched'
        ? 'Ya estás en los playoffs'
        : status === 'eliminated'
          ? 'Estás fuera de la carrera por los playoffs'
          : playoffPct >= 90
            ? `Casi seguro dentro: ${pctWordsEs(playoffPct)} de llegar a los playoffs`
            : playoffPct >= 60
              ? `Probablemente dentro: ${pctWordsEs(playoffPct)} de llegar a los playoffs`
              : playoffPct >= 40
                ? `A cara o cruz: ${pctWordsEs(playoffPct)} de llegar a los playoffs`
                : playoffPct >= 10
                  ? `Con opciones: ${pctWordsEs(playoffPct)} de llegar a los playoffs`
                  : `Muy difícil: ${pctWordsEs(playoffPct)} de llegar a los playoffs`,
    noTeamTitle: 'No sabemos cuál es tu equipo en esta liga.',
    noTeamBody:
      'Cada número de esta pantalla trata de tu posición en la liga, así que nada puede mostrarse hasta que la plantilla se empareje con tu cuenta. La clasificación de la liga sigue abajo.',
    forecastHeading: (seed) => `Tu pronóstico · ${ordinalEs(seed)} puesto`,
    clearOfCut: (games) => `${games} por encima del corte · `,
    levelWithCut: 'igualado con el corte · ',
    backOfCut: (games) => `${games} por debajo del corte · `,
    regularSeasonOver: 'temporada regular terminada',
    toPlay: (weeks) => `${weeks} por jugar`,
    playoffsLabel: 'Playoffs',
    vsOpponent: (name) => ` · contra ${name}`,
    playoffsSub: (playoffTeams, teamCount) => `los ${playoffTeams} primeros de ${teamCount}`,
    byeLabel: 'Descanso en primera ronda',
    byeSub: (byeTeams) => (byeTeams === 1 ? 'el primer puesto' : `los ${byeTeams} primeros puestos`),
    title: 'Título',
    titleSub: 'ganar el cuadro',
    nextAction: 'Siguiente acción',
    playoffPts: 'de probabilidad de playoffs',
    setLineup: 'Ajusta tu alineación',
    openWaivers: 'Abrir agentes libres',
    winWeek: (week) => `Gana la semana ${week}`,
    againstOpponent: (opponentName) => ` contra ${opponentName}`,
    worthPrefix: 'Vale ',
    swingOdds: (ifWin, ifLose) => ` de probabilidad de playoffs: ${ifWin}% si ganas, ${ifLose}% si pierdes.`,
    openThatMatchup: 'Abrir ese enfrentamiento',
    nothingHereElsewhere: (leagueName) => `Aquí no hace falta nada; en ${leagueName}, sí.`,
    open: 'Abrir',
    nothingNeedsDecision: 'Nada en esta liga necesita una decisión ahora mismo.',
    whatMovesSeason: 'Lo que más mueve tu temporada',
    driversLater: 'Los factores se calculan cuando esta liga se abre por separado.',
    driversNote: 'Cuánto cambia cada uno tus probabilidades de playoffs, frente a un equipo promedio.',
    tabsAria: 'Detalle de la proyección de temporada',
    tooFewWeeks: 'Tu equipo tiene muy pocas semanas completas para proyectar un récord.',
    whatIfsUnavailable: 'No se pudieron preparar escenarios para esta liga ahora mismo.',
    recommendedMoves: 'Movimientos recomendados',
    movesUnavailable: 'No se pudieron preparar movimientos para esta liga ahora mismo.',
    movesNote: (iterations) =>
      `Cada movimiento se simula con y sin él sobre la misma temporada${
        iterations != null ? `, ${iterations.toLocaleString('es-ES')} veces cada uno` : ''
      }. Aquí no se sugieren intercambios: prueba uno en Escenarios.`,
    everyFactor: 'Todos los factores que medimos',
    rosterRiskUnavailable: 'No se pudo leer el riesgo de plantilla de esta liga.',
    whereAttention: 'Dónde poner tu atención',
    attentionNote: 'tus otras ligas, primero la más urgente',
    seasonOutlookTitle: 'Proyección de temporada',
    seasonOutlookSub: 'Tus probabilidades de llegar a los playoffs y de ganar el título, a partir de temporadas simuladas de esta liga.',
    howYouClinch: 'Cómo clasificas',
    seasonOverClinch: 'La temporada regular terminó en esta liga: no queda nada por asegurar.',
    noNextGame: 'No encontramos tu próximo partido sin jugar en esta liga, así que no hay un único resultado del que partir.',
    week: 'Semana',
    ifYouWin: 'Si ganas',
    clinchOnWin: 'Estás dentro. Gana esto y lo demás es cuestión de posición.',
    notDecided: 'Aún no está decidido, pero es el movimiento más grande que tienes a tu alcance.',
    ifYouLose: 'Si pierdes',
    noSingleRescue: 'Ningún otro resultado por sí solo te rescata: necesitarías que varios partidos salieran a tu favor, no uno.',
    needOne: (team) =>
      `Necesitarías que ${team} también se quedara fuera. Esa ausencia sube tus probabilidades más que cualquier otro resultado.`,
    needTwo: (a, b) =>
      `Necesitarías que ${a} o ${b} también se quedaran fuera: esas dos ausencias mueven tu número más que cualquier otra cosa que no controlas.`,
    standingsCaption: (leagueName) =>
      `Todos los equipos de ${leagueName}, ordenados por su posición actual. La línea marca el corte de playoffs. Pasa el cursor por un porcentaje de playoffs para ver su rango.`,
    team: 'Equipo',
    record: 'Récord',
    pointsFor: 'Puntos a favor',
    bye: 'Descanso',
    whatDecides: 'Qué lo decide',
    unnamedTeam: 'Equipo sin nombre',
    you: 'Tú',
    range: 'Rango',
    historyTitle: 'Cómo cambiaron tus probabilidades',
    historyWeek: (week) => `Semana ${week}`,
    historyWeekShort: (week) => `S${week}`,
    historyAria: (from, to) => `Tus probabilidades de playoffs y de título por semana, de la semana ${from} a la ${to}`,
    historyNote: 'Tus probabilidades simuladas tal como estaban cada semana, de las mismas simulaciones que los números de arriba.',
    historyTable: 'Ver los números',
  },
})
