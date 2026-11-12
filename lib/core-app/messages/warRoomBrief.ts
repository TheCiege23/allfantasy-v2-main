import { defineMessages } from '@/lib/i18n/messages'
import type { NextSeasonView } from '@/lib/core-app/warRoomNextSeason'

type Window = Extract<NextSeasonView, { kind: 'dynasty' }>['window']
type Posture = Extract<NextSeasonView, { kind: 'dynasty' }>['posture']

/**
 * War Room phase 3 (components/core-app/screens/WarStrategyBrief.tsx): the format brief and the
 * next-season plan.
 *
 * ⚠ THE SCARCITY LINES ARE MEASUREMENTS AND READ AS SUCH — "starters average X, the best free agent
 * Y" — never "TEs are valuable". The dynasty engine writes its explanation sentences in English; they
 * are translated where they are drawn (dynastyFactsSpanish.ts). The labels around them live here.
 */
export const warRoomBriefMessages = defineMessages({
  en: {
    formatHeading: 'How this league is won',
    lineupLabel: 'Starting lineup',
    twoQb: 'A second quarterback can start here.',
    scoringLabel: 'Scoring that differs from standard PPR',
    scoringStandard: 'Scoring matches standard PPR.',
    scarcityLead: (week: number | null) =>
      `Each position’s average starter across the league against the best player nobody rosters, on ${week == null ? 'this week’s' : `week ${week}`} projections in this league’s scoring. The bigger the gap, the harder a good starter is to replace.`,
    scarcityRow: (pos: string, avg: string, gap: string | null, fa: string | null, faPts: string | null) =>
      `${pos}: starters average ${avg}${fa ? ` · best free agent ${faPts} (${fa})` : ' · no free agent scanned'}${gap ? ` · gap ${gap}` : ''}`,
    youVs: (d: string) => `you ${d}`,
    edge: (pos: string, d: string) => `Your biggest edge: ${pos} (${d} a week over the league’s average starter).`,
    hole: (pos: string, d: string) => `Your biggest hole: ${pos} (${d} a week under it).`,
    scarcityNone: (reason: string | null) => `Scarcity could not be measured${reason ? `: ${reason}` : '.'}`,
    calendarLabel: 'Calendar',
    playoffs: (teams: number, byes: number | null) => `${teams} teams make the playoffs${byes ? `, top ${byes} get a bye` : ''}`,
    playoffStart: (week: number) => `playoffs start week ${week}`,
    deadline: (week: number) => `trade deadline week ${week}`,
    noDeadline: 'no trade deadline stated',
    weeksLeft: (n: number) => (n === 0 ? 'regular season done' : `${n} ${n === 1 ? 'week' : 'weeks'} left in the regular season`),

    nextHeading: 'Next season',
    window: (w: Window): string =>
      ({ contend: 'Window open — contend', rebuild: 'Rebuild', middle: 'In between', unknown: 'Window unclear' })[w],
    posture: (p: Posture): string =>
      ({
        buy_win_now: 'Buy: trade future value for this year’s starters.',
        sell_for_youth: 'Sell: move aging starters for young players and picks.',
        balanced: 'Balanced: buy and sell at the margins.',
        unknown: 'No clear direction from the data on file.',
      })[p],
    avgAge: (age: string) => `Average starter age ${age}`,
    earlyPicks: (n: number) => `${n} early ${n === 1 ? 'pick' : 'picks'} held`,
    contendScore: (n: number) => `contention score ${n}/100`,
    partial: (n: number) => `${n} ${n === 1 ? 'input is' : 'inputs are'} missing, so this read is partial.`,
    keepLabel: (n: number, max: number) => `Keep (${n} of ${max} allowed)`,
    bubbleLabel: 'On the bubble',
    avoidLabel: 'Let go — they cost more than they’re worth',
    keeperLine: (name: string, pos: string, cost: string | null, surplus: string | null) =>
      `${name}, ${pos}${cost ? ` — ${cost}` : ' — no cost recorded'}${surplus ? ` · ${surplus} rounds of value` : ''}`,
    draftPlan: (rounds: string | null, positions: string | null) =>
      [rounds ? `Rounds your keepers use: ${rounds}` : null, positions ? `Target first in the draft: ${positions}` : null].filter(Boolean).join(' · '),
    keeperPartial: 'Some keeper costs or values aren’t recorded, so this plan is partial.',
    noneOneSeason: 'Nothing carries over in this league, so there’s no next-season plan to make.',
    noneUnavailable: (reason: string | null) => `A next-season plan isn’t available for this league${reason ? ` (${reason})` : ''}.`,
    noneNoTeam: 'We can’t tell which team in this league is yours, so there’s no plan to make.',
  },
  es: {
    formatHeading: 'Cómo se gana esta liga',
    lineupLabel: 'Alineación titular',
    twoQb: 'Aquí puede jugar un segundo mariscal de campo.',
    scoringLabel: 'Puntuación distinta del PPR estándar',
    scoringStandard: 'La puntuación es PPR estándar.',
    scarcityLead: (week) =>
      `El titular promedio de cada posición en la liga contra el mejor jugador que nadie tiene, con las proyecciones de ${week == null ? 'esta semana' : `la semana ${week}`} y la puntuación de esta liga. Cuanto mayor la diferencia, más difícil es reemplazar a un buen titular.`,
    scarcityRow: (pos, avg, gap, fa, faPts) =>
      `${pos}: los titulares promedian ${avg}${fa ? ` · mejor agente libre ${faPts} (${fa})` : ' · sin agente libre revisado'}${gap ? ` · diferencia ${gap}` : ''}`,
    youVs: (d) => `tú ${d}`,
    edge: (pos, d) => `Tu mayor ventaja: ${pos} (${d} por semana sobre el titular promedio de la liga).`,
    hole: (pos, d) => `Tu mayor hueco: ${pos} (${d} por semana por debajo).`,
    scarcityNone: (reason) => `No se pudo medir la escasez${reason ? `: ${reason}` : '.'}`,
    calendarLabel: 'Calendario',
    playoffs: (teams, byes) => `${teams} equipos llegan a playoffs${byes ? `, los ${byes} primeros descansan` : ''}`,
    playoffStart: (week) => `los playoffs empiezan en la semana ${week}`,
    deadline: (week) => `fecha límite de cambios en la semana ${week}`,
    noDeadline: 'sin fecha límite de cambios declarada',
    weeksLeft: (n) => (n === 0 ? 'temporada regular terminada' : n === 1 ? 'queda 1 semana de temporada regular' : `quedan ${n} semanas de temporada regular`),

    nextHeading: 'Próxima temporada',
    window: (w) =>
      ({ contend: 'Ventana abierta — a competir', rebuild: 'Reconstrucción', middle: 'A medio camino', unknown: 'Ventana poco clara' })[w as Window],
    posture: (p) =>
      ({
        buy_win_now: 'Compra: cambia valor futuro por titulares de este año.',
        sell_for_youth: 'Vende: mueve titulares veteranos por jugadores jóvenes y selecciones.',
        balanced: 'Equilibrio: compra y vende en los márgenes.',
        unknown: 'Los datos registrados no muestran una dirección clara.',
      })[p as Posture],
    avgAge: (age) => `Edad promedio de los titulares ${age}`,
    earlyPicks: (n) => `${n} ${n === 1 ? 'selección temprana' : 'selecciones tempranas'}`,
    contendScore: (n) => `puntuación de competencia ${n}/100`,
    partial: (n) => `Faltan ${n} ${n === 1 ? 'dato' : 'datos'}, así que esta lectura es parcial.`,
    keepLabel: (n, max) => `Conservar (${n} de ${max} permitidos)`,
    bubbleLabel: 'En la burbuja',
    avoidLabel: 'Déjalos ir — cuestan más de lo que valen',
    keeperLine: (name, pos, cost, surplus) =>
      `${name}, ${pos}${cost ? ` — ${cost}` : ' — sin costo registrado'}${surplus ? ` · ${surplus} rondas de valor` : ''}`,
    draftPlan: (rounds, positions) =>
      [rounds ? `Rondas que usan tus conservados: ${rounds}` : null, positions ? `Busca primero en el draft: ${positions}` : null].filter(Boolean).join(' · '),
    keeperPartial: 'Algunos costos o valores de conservación no están registrados, así que este plan es parcial.',
    noneOneSeason: 'En esta liga nada se conserva, así que no hay plan para la próxima temporada.',
    noneUnavailable: (reason) => `No hay plan de próxima temporada para esta liga${reason ? ` (${reason})` : ''}.`,
    noneNoTeam: 'No sabemos cuál equipo de esta liga es el tuyo, así que no hay plan que hacer.',
  },
})
