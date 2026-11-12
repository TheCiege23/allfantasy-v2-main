import { defineMessages } from '@/lib/i18n/messages'

/**
 * War Room phase 8 — the race (components/core-app/screens/WarRace.tsx).
 *
 * ⚠ MEASUREMENTS, NEVER LABELS. A schedule is "the 3rd hardest left of 12", an opponent average is a
 * number against the league's; nobody is called soft, lucky, fading or a lock.
 */
export const warRoomRaceMessages = defineMessages({
  en: {
    heading: 'The race',
    lead: (cut: number) =>
      `The teams fighting over the playoff spots, in seed order — the top ${cut} make it. Schedule left: 1 is the hardest remaining schedule in the league.`,
    you: 'You',
    inField: 'in',
    out: 'out',
    record: (rec: string, pts: string) => `${rec} · ${pts} pts`,
    odds: (pct: string) => `${pct}%`,
    oddsNone: 'not modelled',
    schedule: (rank: number, of: number) => `${ordinal(rank)} hardest of ${of}`,
    scheduleEasiest: (of: number) => `easiest of ${of}`,
    scheduleHardest: (of: number) => `hardest of ${of}`,
    scheduleNone: 'no schedule left',
    opp: (avg: string, league: string | null) => `opponents avg ${avg}${league ? ` (league ${league})` : ''}`,
    vsYou: (weeks: number[]) => `plays you in week${weeks.length === 1 ? '' : 's'} ${weeks.join(', ')}`,
    colOdds: 'Playoff odds',
    colSchedule: 'Schedule left',
    basis: 'Odds and schedule strength from Season Outlook’s simulation. Ties are broken by points for; divisions and head-to-head tiebreaks aren’t modelled.',
    none: (why: 'settled' | 'unplaced'): string =>
      ({
        settled: 'Your playoff place is settled, so there’s no race to show.',
        unplaced: 'Your team isn’t placed yet, so there’s no race to show.',
      })[why],
  },
  es: {
    heading: 'La carrera',
    lead: (cut) =>
      `Los equipos que pelean por los lugares de playoffs, por sembrado — los ${cut} primeros entran. Calendario restante: 1 es el calendario restante más difícil de la liga.`,
    you: 'Tú',
    inField: 'dentro',
    out: 'fuera',
    record: (rec, pts) => `${rec} · ${pts} pts`,
    odds: (pct) => `${pct}%`,
    oddsNone: 'sin modelar',
    schedule: (rank, of) => `${rank}.º más difícil de ${of}`,
    scheduleEasiest: (of) => `el más fácil de ${of}`,
    scheduleHardest: (of) => `el más difícil de ${of}`,
    scheduleNone: 'sin partidos restantes',
    opp: (avg, league) => `rivales promedian ${avg}${league ? ` (liga ${league})` : ''}`,
    vsYou: (weeks) => `juega contra ti en la${weeks.length === 1 ? '' : 's'} semana${weeks.length === 1 ? '' : 's'} ${weeks.join(', ')}`,
    colOdds: 'Prob. de playoffs',
    colSchedule: 'Calendario restante',
    basis: 'Probabilidades y dificultad del calendario de la simulación de Perspectiva de temporada. Los empates se rompen por puntos a favor; no se modelan divisiones ni desempates por enfrentamiento directo.',
    none: (why) =>
      ({
        settled: 'Tu lugar en playoffs ya está decidido, así que no hay carrera que mostrar.',
        unplaced: 'Tu equipo todavía no está ubicado, así que no hay carrera que mostrar.',
      })[why as 'settled' | 'unplaced'],
  },
})

function ordinal(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}
