import { defineMessages } from '@/lib/i18n/messages'
import type { PlayoffReady } from '@/lib/core-app/warRoomPlayoffReady'

type NoneWhy = Extract<PlayoffReady, { kind: 'none' }>['why']

/**
 * War Room phase 7 — playoff readiness (components/core-app/screens/WarPlayoffReady.tsx).
 *
 * ⚠ ALL OF IT IS ABOUT YOUR OWN ROSTER, so it can speak plainly: "losing him costs 9.4 a week" is a
 * measurement of your depth, and naming where to add depth is advice about your own team.
 */
export const warRoomPlayoffReadyMessages = defineMessages({
  en: {
    heading: 'Playoff readiness',
    weeks: (span: string, n: number) => `Your playoffs: ${n === 1 ? 'week' : 'weeks'} ${span}.`,
    odds: (title: string, playoff: string, bye: string | null) =>
      `Title odds ${title}% · playoffs ${playoff}%${bye ? ` · bye ${bye}%` : ''}`,
    byeHeading: 'On bye in your playoffs',
    byeNone: 'No starter of yours is on bye in your playoff weeks.',
    byeRow: (name: string, pos: string, week: number) => `${name} (${pos}) — bye in week ${week}`,
    injuredHeading: 'Carrying an injury designation now',
    injuredNone: 'No starter of yours carries an injury designation right now.',
    injuredRow: (name: string, pos: string, status: string) => `${name} (${pos}) — ${status}`,
    thinHeading: 'Where one injury hurts most',
    thinLead: 'Each starter against the next man up at his position on your roster. The bigger the drop, the more depth is worth adding there.',
    thinRow: (name: string, pos: string, drop: string, backup: string | null) =>
      backup ? `${pos}: losing ${name} means starting ${backup} — ${drop} pts/week less.` : `${pos}: no one behind ${name} — losing him costs all ${drop} pts/week.`,
    thinNone: 'Every starter has a backup within a couple of points — your depth holds.',
    basis: (week: number | null) =>
      `Points are ${week == null ? 'this week’s' : `week ${week}`} projections in your league’s scoring; byes from the NFL schedule; injuries as of the last sync. Players on IR or the taxi squad aren’t counted.`,
    none: (why: NoneWhy): string =>
      ({
        out_of_it: 'Playoff readiness is for teams still in the title race.',
        no_dates: 'This league doesn’t state when its playoffs start, so there are no playoff weeks to check.',
        not_priced: 'Your roster couldn’t be read for this league, so readiness can’t be checked.',
      })[why],
  },
  es: {
    heading: 'Preparación para playoffs',
    weeks: (span, n) => `Tus playoffs: ${n === 1 ? 'semana' : 'semanas'} ${span}.`,
    odds: (title, playoff, bye) => `Prob. de título ${title}% · playoffs ${playoff}%${bye ? ` · descanso ${bye}%` : ''}`,
    byeHeading: 'En descanso durante tus playoffs',
    byeNone: 'Ningún titular tuyo descansa en tus semanas de playoffs.',
    byeRow: (name, pos, week) => `${name} (${pos}) — descansa en la semana ${week}`,
    injuredHeading: 'Con designación de lesión ahora',
    injuredNone: 'Ningún titular tuyo tiene designación de lesión ahora mismo.',
    injuredRow: (name, pos, status) => `${name} (${pos}) — ${status}`,
    thinHeading: 'Donde una lesión duele más',
    thinLead: 'Cada titular frente al siguiente en su posición en tu plantel. Cuanto mayor la caída, más vale sumar profundidad ahí.',
    thinRow: (name, pos, drop, backup) =>
      backup
        ? `${pos}: perder a ${name} significa poner a ${backup} — ${drop} pts/semana menos.`
        : `${pos}: no hay nadie detrás de ${name} — perderlo cuesta los ${drop} pts/semana.`,
    thinNone: 'Cada titular tiene un suplente a un par de puntos — tu profundidad aguanta.',
    basis: (week) =>
      `Los puntos son proyecciones de ${week == null ? 'esta semana' : `la semana ${week}`} con la puntuación de tu liga; descansos según el calendario de la NFL; lesiones según la última sincronización. No se cuentan jugadores en IR ni en el taxi squad.`,
    none: (why) =>
      ({
        out_of_it: 'La preparación para playoffs es para equipos que siguen en la pelea por el título.',
        no_dates: 'Esta liga no indica cuándo empiezan sus playoffs, así que no hay semanas de playoffs que revisar.',
        not_priced: 'No se pudo leer tu plantel en esta liga, así que no se puede revisar la preparación.',
      })[why as NoneWhy],
  },
})
