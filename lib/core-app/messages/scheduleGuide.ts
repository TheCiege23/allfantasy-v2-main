import { defineMessages } from '@/lib/i18n/messages'

/**
 * A league's Schedule tab (components/core-app/screens/LeagueSchedule.tsx, lib/core-app/scheduleGuide.ts).
 *
 * ⚠ SPANISH FOLLOWS THE APP'S WORDING RULINGS (__tests__/spanish-wording-rulings.test.tsx): no Spanish
 * value says «waiver»; a claim is «reclamo». The season phases come from seasonTimeline.ts in English
 * only, so `phase` and `phaseDetail` carry their Spanish here, keyed by the exact English string —
 * anything unknown falls through unchanged rather than being guessed.
 */
const pts = (n: number) => n.toFixed(1)
const rec = (r: { wins: number; losses: number; ties: number } | null) => (r ? (r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`) : null)

const PHASE_ES: Record<string, string> = {
  'Regular season': 'Temporada regular',
  Survive: 'Sobrevivir',
  'Trade deadline': 'Fecha límite de intercambios',
  'Run-in': 'Recta final',
  'Last one with a head': 'El último que conserve la cabeza',
  'Last team standing': 'El último equipo en pie',
  Playoffs: 'Playoffs',
  Championship: 'Final',
  Offseason: 'Fuera de temporada',
  Draft: 'Draft',
  'Draft — on the clock': 'Draft: en el reloj',
  Preseason: 'Pretemporada',
  'Next waiver processing': 'Próximo proceso de reclamos',
  'Keeper deadline': 'Fecha límite de keepers',
  'Playoffs start': 'Empiezan los playoffs',
}
const DETAIL_ES: Record<string, string> = {
  'No trades accepted after it': 'No se aceptan intercambios después',
  'No bracket — the league runs until one team is left': 'Sin cuadro: la liga sigue hasta que quede un equipo',
  'Rookie draft order, keepers and taxi decisions': 'Orden del draft de novatos, keepers y decisiones del taxi',
  'Season finished — rosters carry over': 'Temporada terminada: las plantillas continúan',
  'Not started': 'Sin empezar',
  'Exhibition games — projections do not describe a fantasy week': 'Partidos de exhibición: las proyecciones no describen una semana de fantasy',
}

export const scheduleGuideMessages = defineMessages({
  en: {
    eyebrow: (league: string) => `Schedule · ${league}`,
    headNone: 'Schedule and deadlines',
    headGame: (week: number, opp: string, you: number, them: number, started: boolean) =>
      `Week ${week} · you vs ${opp}${
        !started ? '' : you > them ? ` — you lead ${pts(you)} to ${pts(them)}` : you < them ? ` — you trail ${pts(you)} to ${pts(them)}` : ` — tied at ${pts(you)}`
      }`,
    headPhase: (week: number | null, label: string, next: string | null) =>
      `${week != null ? `Week ${week} · ` : ''}${label}${next ? ` — ${next}` : ''}`,
    /** "trade deadline next week" — the next item in a headline, lower-cased as part of a sentence. */
    nextInline: (label: string, when: string) => `${label.charAt(0).toLowerCase()}${label.slice(1)} ${when}`,
    /** The forward headline (2026-11-13 follow-up): what is left, and the next game. */
    headAhead: (n: number, beforePlayoffs: boolean, week: number, opp: string, r: { wins: number; losses: number; ties: number } | null) =>
      `${n} ${n === 1 ? 'game' : 'games'} left${beforePlayoffs ? ' before the playoffs' : ''} · next: week ${week} vs ${opp}${rec(r) ? ` (${rec(r)})` : ''}`,
    intro: 'What’s coming up in this league: your game each week, the deadlines, and when the playoffs start.',
    gamesLeftTitle: 'Your games left',
    gamesLeftSub: (beforePlayoffs: boolean): string => (beforePlayoffs ? 'Regular season, after this week' : 'After this week'),
    gameLeftWeek: (week: number) => `Week ${week}`,
    gameLeftRecord: (r: { wins: number; losses: number; ties: number } | null) => rec(r) ?? '',
    tough: 'Tough',
    toughTitle: 'In the top third of the league by record',
    thisWeekScore: (week: number, opp: string, you: number, them: number, started: boolean) =>
      started ? `This week (week ${week}): you ${pts(you)}, ${opp} ${pts(them)}` : `This week (week ${week}): you vs ${opp}`,
    whatsNext: 'What’s next',
    now: 'Now',
    thisWeek: 'this week',
    nextWeek: 'next week',
    inWeeks: (n: number) => `in ${n} weeks`,
    weeks: (start: number, end: number | null) =>
      end == null ? `week ${start} onward` : start === end ? `week ${start}` : `weeks ${start}–${end}`,
    teamsIn: (n: number) => `${n} teams make it`,
    phase: (label: string) => label,
    phaseDetail: (detail: string) => detail,
    rulesWaivers: 'Waiver rules and claims',
    rulesTrades: 'Trade rules and offers',
    /** The games list's heading; the week is already in the switcher and the panel's own label. */
    games: 'Games',
    startsWeek: (n: number) => `starts week ${n}`,
    yourGame: 'Your game is highlighted.',
    prevWeek: 'Previous week',
    nextWeekBtn: 'Next week',
    weekLabel: 'Week',
    current: 'current',
    futureWeek: (week: number) => `Week ${week} hasn’t been played — these are the scheduled games.`,
  },
  es: {
    eyebrow: (league) => `Calendario · ${league}`,
    headNone: 'Calendario y fechas límite',
    headGame: (week, opp, you, them, started) =>
      `Semana ${week} · tú contra ${opp}${
        !started ? '' : you > them ? ` — ganas ${pts(you)} a ${pts(them)}` : you < them ? ` — pierdes ${pts(you)} a ${pts(them)}` : ` — empate a ${pts(you)}`
      }`,
    headPhase: (week, label, next) => `${week != null ? `Semana ${week} · ` : ''}${label}${next ? ` — ${next}` : ''}`,
    nextInline: (label, when) => `${label.charAt(0).toLowerCase()}${label.slice(1)} ${when}`,
    intro: 'Lo que viene en esta liga: tu partido de cada semana, las fechas límite y cuándo empiezan los playoffs.',
    headAhead: (n, beforePlayoffs, week, opp, r) =>
      `${n === 1 ? 'Queda 1 partido' : `Quedan ${n} partidos`}${beforePlayoffs ? ' antes de los playoffs' : ''} · próximo: semana ${week} contra ${opp}${rec(r) ? ` (${rec(r)})` : ''}`,
    gamesLeftTitle: 'Tus partidos restantes',
    gamesLeftSub: (beforePlayoffs) => (beforePlayoffs ? 'Temporada regular, después de esta semana' : 'Después de esta semana'),
    gameLeftWeek: (week) => `Semana ${week}`,
    gameLeftRecord: (r) => rec(r) ?? '',
    tough: 'Difícil',
    toughTitle: 'En el tercio de arriba de la liga por récord',
    thisWeekScore: (week, opp, you, them, started) =>
      started ? `Esta semana (semana ${week}): tú ${pts(you)}, ${opp} ${pts(them)}` : `Esta semana (semana ${week}): tú contra ${opp}`,
    whatsNext: 'Lo que viene',
    now: 'Ahora',
    thisWeek: 'esta semana',
    nextWeek: 'la próxima semana',
    inWeeks: (n) => `en ${n} semanas`,
    weeks: (start, end) => (end == null ? `semana ${start} en adelante` : start === end ? `semana ${start}` : `semanas ${start}–${end}`),
    teamsIn: (n) => `${n} equipos clasifican`,
    phase: (label) => PHASE_ES[label] ?? label,
    phaseDetail: (detail) => DETAIL_ES[detail] ?? detail,
    rulesWaivers: 'Reglas de reclamos',
    rulesTrades: 'Reglas de intercambios y ofertas',
    games: 'Partidos',
    startsWeek: (n) => `empieza en la semana ${n}`,
    yourGame: 'Tu partido está resaltado.',
    prevWeek: 'Semana anterior',
    nextWeekBtn: 'Semana siguiente',
    weekLabel: 'Semana',
    current: 'actual',
    futureWeek: (week) => `La semana ${week} aún no se ha jugado: estos son los partidos programados.`,
  },
})
