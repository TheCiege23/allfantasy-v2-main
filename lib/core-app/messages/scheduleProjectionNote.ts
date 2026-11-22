import { defineMessages } from '@/lib/i18n/messages'

/**
 * The player card's schedule note and row values (lib/core-app/scheduleProjectionNote.ts). Every
 * string is the one the module produced before the move, byte for byte, in both languages.
 *
 * ⚠ A CLIENT-SAFE LEAF, like the module it serves: the only runtime import is lib/i18n/messages.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

const LINEUP_TAIL = 'Your lineup view applies league scoring and current injury availability.'
const LINEUP_TAIL_ES = 'Tu alineación aplica la puntuación de la liga y la disponibilidad actual por lesiones.'

export const scheduleProjectionNoteMessages = defineMessages({
  en: {
    // shortAsOf — `month` is the UTC month index
    shortDate: (day: number, month: number) => `${MONTHS[month]} ${day}`,
    // weekList
    week: 'Week',
    weeks: 'Weeks',
    // scheduleProjectionNote, without later-week data
    baselineOnly: (week: number) =>
      `Published baseline projections cover week ${week} only; later weeks show the fixture. ${LINEUP_TAIL}`,
    noProjectedWeek: 'No projected week is published yet; these are fixtures.',
    // scheduleProjectionNote, with later-week data
    currentWeekLine: (week: number) => `Week ${week} is this week's published line.`,
    noCurrentWeekLine: 'No current-week line is published yet.',
    earlyLines: (list: string, asOf: string | null) => `${list}: Sleeper's early PPR lines${asOf ? `, as of ${asOf}` : ''}.`,
    notPublishedYet: 'not published yet',
    noLineOnFile: 'no line on file yet',
    lineupTail: LINEUP_TAIL,
    // scheduleRowValue
    earlyLine: (asOf: string | null) => `Sleeper early line${asOf ? `, as of ${asOf}` : ''}`,
    checked: (asOf: string) => `Checked ${asOf}`,
  },
  es: {
    shortDate: (day, month) => `${day} ${MONTHS_ES[month]}`,
    week: 'Semana',
    weeks: 'Semanas',
    baselineOnly: (week) =>
      `Las proyecciones base publicadas cubren solo la semana ${week}; las semanas siguientes muestran el partido. ${LINEUP_TAIL_ES}`,
    noProjectedWeek: 'Todavía no hay ninguna semana proyectada publicada; estos son los partidos.',
    currentWeekLine: (week) => `La semana ${week} es la línea publicada de esta semana.`,
    noCurrentWeekLine: 'Todavía no se publicó la línea de esta semana.',
    earlyLines: (list, asOf) => `${list}: líneas PPR tempranas de Sleeper${asOf ? `, al ${asOf}` : ''}.`,
    notPublishedYet: 'aún sin publicar',
    noLineOnFile: 'todavía sin línea registrada',
    lineupTail: LINEUP_TAIL_ES,
    earlyLine: (asOf) => `Línea temprana de Sleeper${asOf ? `, al ${asOf}` : ''}`,
    checked: (asOf) => `Revisado el ${asOf}`,
  },
})
