import { defineMessages } from '@/lib/i18n/messages'
import type { WarPosture } from '@/lib/core-app/warRoomFront'

/**
 * The Front (components/core-app/screens/WarFront.tsx) — the War Room's strategist view.
 *
 * ⚠ ORDERS ARE STRATEGY, STATED AS SUCH — NEVER A PREDICTION. Every number in them is Season
 * Outlook's; the sentence around it is the play that number calls for. Nothing here claims a trade
 * will be accepted or a player will score.
 */
export const warRoomFrontMessages = defineMessages({
  en: {
    heading: 'The Front · every team you run',
    blurb: 'Where each of your teams stands and the play it calls for — playoff odds from Season Outlook’s simulation of the real remaining schedule.',
    unavailable: 'Playoff odds could not be read right now, so no team has been placed. Season Outlook has the full board.',
    outlookLink: 'Season Outlook',
    posture: (p: WarPosture): string =>
      ({
        bubble: 'On the bubble',
        contender: 'Contender',
        long_shot: 'Long shot',
        clinched: 'Clinched',
        eliminated: 'Out of the race',
        unplaced: 'Not placed',
      })[p],
    countsLabel: 'Your teams by situation',
    count: (n: number, p: WarPosture): string =>
      `${n} ${
        {
          bubble: 'on the bubble',
          contender: n === 1 ? 'contender' : 'contenders',
          long_shot: n === 1 ? 'long shot' : 'long shots',
          clinched: 'clinched',
          eliminated: 'out of the race',
          unplaced: 'not placed',
        }[p]
      }`,
    playoffOdds: 'Playoffs',
    byeOdds: 'Bye',
    titleOdds: 'Title',
    seedOf: (seed: number, teams: number) => `#${seed} of ${teams}`,
    weeksLeft: (n: number) => (n === 0 ? 'regular season done' : `${n} ${n === 1 ? 'week' : 'weeks'} left`),
    carriesOver: 'roster carries over',
    scout: 'Scout the room',
    orderSwingGame: (week: number, opponent: string | null, ifWin: string, ifLose: string, clinch: boolean) =>
      `Week ${week}${opponent ? ` vs ${opponent}` : ''} is your swing game: ${clinch ? 'win and you are in' : `win → ${ifWin}%`}, lose → ${ifLose}%. Set your strongest lineup for it.`,
    orderChaseBye: (pct: string) => `The bye is in play (${pct}%). A week off in round one is worth chasing — treat the last regular-season games as must-wins.`,
    orderTitleOdds: (pct: string) => `You’re in. Title odds ${pct}% — every move now should strengthen the lineup you’ll start in the playoff weeks.`,
    orderPricedMoves: 'See the lineup and waiver moves priced in playoff odds for this league.',
    orderDeadlineBuy: (week: number, left: number) =>
      `${left === 0 ? 'Trade deadline is this week' : `Trade deadline in ${left} ${left === 1 ? 'week' : 'weeks'} (week ${week})`} — buy the starter that gets you over the line before it closes.`,
    orderDeadlineConsolidate: (week: number, left: number) =>
      `${left === 0 ? 'Trade deadline is this week' : `Trade deadline in ${left} ${left === 1 ? 'week' : 'weeks'} (week ${week})`} — turn bench depth into a stronger starter while trades are open.`,
    orderDeadlineSell: (week: number, left: number) =>
      `${left === 0 ? 'Trade deadline is this week' : `Trade deadline in ${left} ${left === 1 ? 'week' : 'weeks'} (week ${week})`} — contenders pay most for proven starters right before it.`,
    orderBuildNextSeasonOpen:
      'Play for next season: veterans are worth most to contending teams now — trade them for young players and picks.',
    orderBuildNextSeasonClosed:
      'Play for next season: trades are closed, so plan the offseason — which veterans to move, which young players to keep, and your draft capital.',
    orderRedraftNothingCarries:
      'Redraft: nothing carries over, so there is no rebuild to play for. Play it out, and note what went wrong for next year’s draft.',
    orderUnplacedWithheld: (reason: string) => `Not placed: ${reason}`,
    orderUnplacedNoTeam: 'Not placed: we can’t tell which team in this league is yours.',
    orderUnplacedTooFewWeeks: (n: number | null) =>
      `Not placed yet: ${n == null ? 'too few' : n === 1 ? 'only 1 week' : `only ${n} weeks`} of scores to model — odds start after 3.`,
    orderUnplacedNotModelled: 'Not placed: this league is not on Season Outlook’s board.',
    notPlacedSummary: (n: number) => `${n} ${n === 1 ? 'team' : 'teams'} not placed — which, and why`,
  },
  es: {
    heading: 'El frente · todos tus equipos',
    blurb: 'Dónde está cada uno de tus equipos y la jugada que pide — probabilidades de playoffs de la simulación de Perspectiva de temporada con el calendario real que queda.',
    unavailable: 'No se pudieron leer las probabilidades de playoffs ahora mismo, así que ningún equipo fue ubicado. Perspectiva de temporada tiene el tablero completo.',
    outlookLink: 'Perspectiva de temporada',
    posture: (p) =>
      ({
        bubble: 'En la burbuja',
        contender: 'Contendiente',
        long_shot: 'Remoto',
        clinched: 'Clasificado',
        eliminated: 'Fuera de carrera',
        unplaced: 'Sin ubicar',
      })[p as WarPosture],
    countsLabel: 'Tus equipos por situación',
    count: (n, p) =>
      `${n} ${
        {
          bubble: 'en la burbuja',
          contender: n === 1 ? 'contendiente' : 'contendientes',
          long_shot: n === 1 ? 'remoto' : 'remotos',
          clinched: n === 1 ? 'clasificado' : 'clasificados',
          eliminated: 'fuera de carrera',
          unplaced: 'sin ubicar',
        }[p as WarPosture]
      }`,
    playoffOdds: 'Playoffs',
    byeOdds: 'Descanso',
    titleOdds: 'Título',
    seedOf: (seed, teams) => `#${seed} de ${teams}`,
    weeksLeft: (n) => (n === 0 ? 'temporada regular terminada' : `${n === 1 ? 'queda 1 semana' : `quedan ${n} semanas`}`),
    carriesOver: 'el plantel se conserva',
    scout: 'Explorar la liga',
    orderSwingGame: (week, opponent, ifWin, ifLose, clinch) =>
      `La semana ${week}${opponent ? ` contra ${opponent}` : ''} es tu partido decisivo: ${clinch ? 'si ganas, entras' : `si ganas → ${ifWin}%`}, si pierdes → ${ifLose}%. Pon tu alineación más fuerte.`,
    orderChaseBye: (pct) => `El descanso está en juego (${pct}%). Una semana libre en la primera ronda vale la pena: trata los últimos partidos de la temporada regular como obligatorios.`,
    orderTitleOdds: (pct) => `Ya estás dentro. Probabilidad de título ${pct}% — cada movimiento ahora debe reforzar la alineación de las semanas de playoffs.`,
    orderPricedMoves: 'Mira los movimientos de alineación y agentes libres valorados en probabilidad de playoffs para esta liga.',
    orderDeadlineBuy: (week, left) =>
      `${left === 0 ? 'La fecha límite de cambios es esta semana' : `Fecha límite de cambios en ${left} ${left === 1 ? 'semana' : 'semanas'} (semana ${week})`}: compra el titular que te mete en playoffs antes de que cierre.`,
    orderDeadlineConsolidate: (week, left) =>
      `${left === 0 ? 'La fecha límite de cambios es esta semana' : `Fecha límite de cambios en ${left} ${left === 1 ? 'semana' : 'semanas'} (semana ${week})`}: convierte profundidad de banca en un titular más fuerte mientras se pueda cambiar.`,
    orderDeadlineSell: (week, left) =>
      `${left === 0 ? 'La fecha límite de cambios es esta semana' : `Fecha límite de cambios en ${left} ${left === 1 ? 'semana' : 'semanas'} (semana ${week})`}: los contendientes pagan más por titulares probados justo antes.`,
    orderBuildNextSeasonOpen:
      'Juega para la próxima temporada: los veteranos valen más ahora para los equipos que compiten — cámbialos por jugadores jóvenes y selecciones.',
    orderBuildNextSeasonClosed:
      'Juega para la próxima temporada: los cambios están cerrados, así que planea la pretemporada — qué veteranos mover, qué jóvenes conservar y tus selecciones del draft.',
    orderRedraftNothingCarries:
      'Redraft: nada se conserva, así que no hay reconstrucción por la que jugar. Termina la temporada y anota qué falló para el draft del próximo año.',
    orderUnplacedWithheld: (reason) => `Sin ubicar: ${reason}`,
    orderUnplacedNoTeam: 'Sin ubicar: no sabemos cuál equipo de esta liga es el tuyo.',
    orderUnplacedTooFewWeeks: (n) =>
      `Sin ubicar todavía: ${n == null ? 'muy pocas semanas' : n === 1 ? 'solo 1 semana' : `solo ${n} semanas`} de puntos para modelar — las probabilidades empiezan después de 3.`,
    orderUnplacedNotModelled: 'Sin ubicar: esta liga no está en el tablero de Perspectiva de temporada.',
    notPlacedSummary: (n) => `${n} ${n === 1 ? 'equipo sin ubicar' : 'equipos sin ubicar'}: cuáles y por qué`,
  },
})
