import { defineMessages } from '@/lib/i18n/messages'
import type { WarPosture } from '@/lib/core-app/warRoomFront'

/**
 * War Room phase 4 — the brief handed to Chimmy (lib/core-app/warRoomPlanPrompt.ts) and its button.
 *
 * ⚠ THIS TEXT IS WHAT THE USER SENDS, SO IT IS IN THEIR LANGUAGE. A prefill lands in the composer
 * unsent and goes out as the user's own words; an English brief under a Spanish screen makes a
 * Spanish speaker ask in English (the same reason LineupIntelligenceActions translates its prefill).
 *
 * ⚠ THE ASK NAMES ITS SOURCES AND ASKS FOR UNCERTAINTY. Every number in the brief is Season Outlook's
 * simulation or the War Room's lineup arithmetic, and the instruction says so, so Chimmy treats them
 * as inputs to reason from rather than as facts to restate — and says what it cannot know.
 */
export const warRoomPlanMessages = defineMessages({
  en: {
    button: 'Plan with Chimmy',
    buttonLabel: (league: string) => `Open Chimmy with a war plan request for ${league}`,
    header: (league: string) => `War plan for ${league}.`,
    posture: (p: WarPosture): string =>
      ({
        bubble: 'Situation: on the playoff bubble.',
        contender: 'Situation: contender.',
        long_shot: 'Situation: long shot.',
        clinched: 'Situation: playoff spot clinched.',
        eliminated: 'Situation: out of the playoff race.',
        unplaced: 'Situation: not placed yet.',
      })[p],
    odds: (playoff: string, bye: string | null, title: string) =>
      `Odds: playoffs ${playoff}%${bye ? `, bye ${bye}%` : ''}, title ${title}%.`,
    record: (rec: string, seed: string | null, weeks: string | null) =>
      `Record ${rec}${seed ? `, seed ${seed}` : ''}${weeks ? `, ${weeks}` : ''}.`,
    weeksLeft: (n: number) => (n === 0 ? 'regular season done' : `${n} ${n === 1 ? 'week' : 'weeks'} left`),
    swing: (week: number, opp: string | null, win: string, lose: string) =>
      `Swing game: week ${week}${opp ? ` vs ${opp}` : ''} — win ${win}%, lose ${lose}%.`,
    decides: (s: string) => `What decides it: ${s}`,
    biggestGame: (week: number, opp: string | null, win: string, lose: string) =>
      `Biggest game left: week ${week}${opp ? ` vs ${opp}` : ''} — win ${win}%, lose ${lose}%.`,
    tiebreakTeam: (name: string, rec: string, gap: string) => `${name} ${rec}, ${gap} pts for vs me`,
    tiebreak: (teams: string) => `Within a win of me (ties broken by points for): ${teams}.`,
    ready: (weeks: string, byes: string | null, hurt: string | null, thin: string | null) =>
      `Playoff weeks ${weeks}.${byes ? ` Starters on bye then: ${byes}.` : ' No starter on bye then.'}${hurt ? ` Injury designations now: ${hurt}.` : ''}${thin ? ` ${thin}` : ''}`,
    readyBye: (name: string, week: number) => `${name} (week ${week})`,
    readyThin: (pos: string, name: string, drop: string) => `Thinnest spot: ${pos} — losing ${name} costs ${drop} pts/week to the next man up.`,
    faab: (amount: string, budget: string | null, rank: number, of: number, useIt: boolean) =>
      `FAAB: ${amount}${budget ? ` of ${budget}` : ''} left, rank ${rank} of ${of}${useIt ? ' — redraft, so it buys nothing after the season' : ''}.`,
    deadline: (week: number, left: number) => `Trade deadline: week ${week} (${left === 0 ? 'this week' : `${left} ${left === 1 ? 'week' : 'weeks'} away`}).`,
    deadlinePassed: 'Trades are closed.',
    trade: (send: string, get: string, partner: string, delta: string, odds: 'playoff' | 'title') =>
      `Best trade found: send ${send}, get ${get} from ${partner} (${delta} ${odds} odds).`,
    sell: (player: string, partner: string) => `Veteran contenders would want: ${player} (most help to ${partner}).`,
    edge: (pos: string, d: string) => `My biggest edge: ${pos} (${d} pts/week over the league's average starter).`,
    hole: (pos: string, d: string) => `My biggest hole: ${pos} (${d} pts/week under it).`,
    scarce: (pos: string, gap: string) => `Scarcest position here: ${pos} (starters ${gap} pts/week above the best free agent).`,
    dynasty: (window: string, posture: string) => `Dynasty read: ${window}; ${posture}`,
    keepers: (names: string, max: number) => `Keeper read: keep ${names} (limit ${max}).`,
    ask:
      'Write my war plan for this league: the three moves that matter most, in order, for this week and the rest of the season. These numbers come from AllFantasy’s Season Outlook simulation and lineup projections — reason from them, check the league data you can read, and say what you’re unsure of.',
  },
  es: {
    button: 'Planear con Chimmy',
    buttonLabel: (league) => `Abrir Chimmy con un pedido de plan de guerra para ${league}`,
    header: (league) => `Plan de guerra para ${league}.`,
    posture: (p) =>
      ({
        bubble: 'Situación: en la burbuja de playoffs.',
        contender: 'Situación: contendiente.',
        long_shot: 'Situación: con pocas opciones.',
        clinched: 'Situación: lugar en playoffs asegurado.',
        eliminated: 'Situación: fuera de la carrera por playoffs.',
        unplaced: 'Situación: todavía sin ubicar.',
      })[p as WarPosture],
    odds: (playoff, bye, title) => `Probabilidades: playoffs ${playoff}%${bye ? `, descanso ${bye}%` : ''}, título ${title}%.`,
    record: (rec, seed, weeks) => `Récord ${rec}${seed ? `, sembrado ${seed}` : ''}${weeks ? `, ${weeks}` : ''}.`,
    weeksLeft: (n) => (n === 0 ? 'temporada regular terminada' : n === 1 ? 'queda 1 semana' : `quedan ${n} semanas`),
    swing: (week, opp, win, lose) => `Partido decisivo: semana ${week}${opp ? ` contra ${opp}` : ''} — si gano ${win}%, si pierdo ${lose}%.`,
    decides: (s) => `Qué lo decide: ${s}`,
    biggestGame: (week, opp, win, lose) => `Partido más importante que queda: semana ${week}${opp ? ` contra ${opp}` : ''} — si gano ${win}%, si pierdo ${lose}%.`,
    tiebreakTeam: (name, rec, gap) => `${name} ${rec}, ${gap} pts a favor frente a mí`,
    tiebreak: (teams) => `A una victoria o menos de mí (los empates se rompen por puntos a favor): ${teams}.`,
    ready: (weeks, byes, hurt, thin) =>
      `Semanas de playoffs ${weeks}.${byes ? ` Titulares en descanso entonces: ${byes}.` : ' Ningún titular descansa entonces.'}${hurt ? ` Designaciones de lesión ahora: ${hurt}.` : ''}${thin ? ` ${thin}` : ''}`,
    readyBye: (name, week) => `${name} (semana ${week})`,
    readyThin: (pos, name, drop) => `Punto más débil: ${pos} — perder a ${name} cuesta ${drop} pts/semana frente al siguiente.`,
    faab: (amount, budget, rank, of, useIt) =>
      `FAAB: me quedan ${amount}${budget ? ` de ${budget}` : ''}, puesto ${rank} de ${of}${useIt ? ' — liga redraft, así que no compra nada después de la temporada' : ''}.`,
    deadline: (week, left) => `Fecha límite de cambios: semana ${week} (${left === 0 ? 'esta semana' : left === 1 ? 'en 1 semana' : `en ${left} semanas`}).`,
    deadlinePassed: 'Los cambios están cerrados.',
    trade: (send, get, partner, delta, odds) =>
      `Mejor cambio encontrado: enviar a ${send}, recibir a ${get} de ${partner} (${delta} prob. de ${odds === 'title' ? 'título' : 'playoffs'}).`,
    sell: (player, partner) => `Veterano que querrían los contendientes: ${player} (más ayuda a ${partner}).`,
    edge: (pos, d) => `Mi mayor ventaja: ${pos} (${d} pts/semana sobre el titular promedio de la liga).`,
    hole: (pos, d) => `Mi mayor hueco: ${pos} (${d} pts/semana por debajo).`,
    scarce: (pos, gap) => `Posición más escasa aquí: ${pos} (los titulares ${gap} pts/semana sobre el mejor agente libre).`,
    dynasty: (window, posture) => `Lectura dynasty: ${window}; ${posture}`,
    keepers: (names, max) => `Lectura de conservados: conservar a ${names} (límite ${max}).`,
    ask:
      'Escribe mi plan de guerra para esta liga: los tres movimientos que más importan, en orden, para esta semana y el resto de la temporada. Estos números vienen de la simulación de Perspectiva de temporada de AllFantasy y de las proyecciones de alineación — razona a partir de ellos, revisa los datos de la liga que puedas leer y di de qué no estás seguro.',
  },
})
