import { defineMessages } from '@/lib/i18n/messages'

/**
 * One league's Trades tab (TradeCenter in components/core-app/screens/TradeCenter.tsx, the history under
 * it in Trades.tsx, lib/core-app/tradesLeagueGuide.ts).
 *
 * ⚠ SPANISH FOLLOWS THE APP'S WORDING RULINGS (__tests__/spanish-wording-rulings.test.tsx): a claim is
 * «reclamo», the pool is «agentes libres», and no Spanish value says «waiver».
 */
export const tradesLeagueGuideMessages = defineMessages({
  en: {
    eyebrow: (league: string) => `Trades · ${league}`,
    headWeeks: (week: number, weeksLeft: number) =>
      weeksLeft === 0
        ? `Last week to trade — the deadline is week ${week}`
        : `Trade deadline after week ${week} — ${weeksLeft} ${weeksLeft === 1 ? 'week' : 'weeks'} left`,
    headClosed: (week: number | null) =>
      week != null ? `Trades are closed — the deadline was week ${week}` : 'Trades are closed for this season',
    headScheduled: (week: number | null) =>
      week != null ? `Trades are open — the deadline is week ${week}` : 'Trades are open',
    headDeadline: (week: number) => `Trade deadline: week ${week}`,
    headOpen: 'Trades stay open all season',
    headBuild: 'Build a trade and get it graded',
    /** Says where to send it when the platform is known; AllFantasy never sends a trade itself. */
    intro: (platform: string | null) =>
      platform
        ? `Add what you send and what you get, and we’ll grade it on this league’s scoring. Then send it in ${platform}.`
        : 'Add what you send and what you get, and we’ll grade it on this league’s scoring.',
    switchLeague: 'Switch league',
    leaguesConnected: (n: number) => `${n} connected`,
    showAllLeagues: (n: number) => `Show all ${n} leagues`,
    current: 'this page',
    more: 'More ways to find a trade',
    moreNote: 'Trade ideas, offers and drafts, the trade finder, value alerts',
    moreWaiting: (n: number) => `${n} ${n === 1 ? 'offer' : 'offers'} waiting on you`,

    /** Followed by the time, in the viewer's own clock (LocalDateTime). */
    historyChecked: (refreshed: boolean) => `Trade history ${refreshed ? 'refreshed' : 'checked'} with Sleeper · grades updated`,
    leagueGradeShort: (got: string, gave: string) => `League grade · got ${got} for ${gave}`,
    realizedShort: (net: string) => `Realized · ${net} pts while held`,
    /** `moment` is `gradeMoment(graded)`; `momentEs` is the same run through `tradeUiCopy`. */
    gradedWhen: (moment: string, _momentEs: string) => `Graded on this league’s values ${moment}.`,
    realizedCaveat: 'A realized grade counts the fantasy points the players scored while held. It doesn’t adjust for team needs or playoff odds.',
    whyTheseGrades: 'How these were graded',
    hideGradeDetails: 'Hide how these were graded',
  },
  es: {
    eyebrow: (league) => `Intercambios · ${league}`,
    headWeeks: (week, weeksLeft) =>
      weeksLeft === 0
        ? `Última semana para intercambiar: la fecha límite es la semana ${week}`
        : `Fecha límite tras la semana ${week}: ${weeksLeft === 1 ? 'queda 1 semana' : `quedan ${weeksLeft} semanas`}`,
    headClosed: (week) =>
      week != null ? `Los intercambios están cerrados: la fecha límite fue la semana ${week}` : 'Los intercambios están cerrados esta temporada',
    headScheduled: (week) =>
      week != null ? `Los intercambios están abiertos: la fecha límite es la semana ${week}` : 'Los intercambios están abiertos',
    headDeadline: (week) => `Fecha límite de intercambios: semana ${week}`,
    headOpen: 'Los intercambios siguen abiertos toda la temporada',
    headBuild: 'Arma un intercambio y recibe su calificación',
    intro: (platform) =>
      platform
        ? `Añade lo que envías y lo que recibes, y lo calificamos con la puntuación de esta liga. Luego envíalo en ${platform}.`
        : 'Añade lo que envías y lo que recibes, y lo calificamos con la puntuación de esta liga.',
    switchLeague: 'Cambiar de liga',
    leaguesConnected: (n) => `${n} conectadas`,
    showAllLeagues: (n) => `Ver las ${n} ligas`,
    current: 'esta página',
    more: 'Más formas de encontrar un intercambio',
    moreNote: 'Ideas, ofertas y borradores, el buscador de intercambios, alertas de valor',
    moreWaiting: (n) => `${n} ${n === 1 ? 'oferta te espera' : 'ofertas te esperan'}`,

    historyChecked: (refreshed) => `Historial de intercambios ${refreshed ? 'actualizado' : 'revisado'} con Sleeper · calificaciones del`,
    leagueGradeShort: (got, gave) => `Calificación de la liga · recibió ${got} por ${gave}`,
    realizedShort: (net) => `Real · ${net} pts mientras los tuvo`,
    gradedWhen: (_moment, momentEs) => `Calificado con los valores de esta liga ${momentEs}.`,
    realizedCaveat: 'La calificación real cuenta los puntos de fantasy que sumaron los jugadores mientras estuvieron en el equipo. No ajusta por necesidades del equipo ni por probabilidades de playoffs.',
    whyTheseGrades: 'Cómo se calificaron',
    hideGradeDetails: 'Ocultar cómo se calificaron',
  },
})
