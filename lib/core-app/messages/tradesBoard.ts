import { defineMessages, messagesFor } from '@/lib/i18n/messages'

/**
 * The cross-league trades board (components/core-app/boards/TradesBoard.tsx), in English and Spanish.
 *
 * Added 2026-11-11: every other trade screen had Spanish and this board had none. The loader's status
 * sentences (`TradeWindowRow.reasoning`, built in lib/core-app/tradesBoard.ts) arrive as English text
 * in a cached payload, so `statusLine` below translates them sentence by sentence; an unrecognised
 * sentence is left in English rather than guessed at.
 */
export const tradesBoardMessages = defineMessages({
  en: {
    eyebrow: 'Core · Trades',
    title: 'Trades',
    blurb: 'Your trade windows, soonest to close first — with the most recent real trade in each league and how it graded.',
    noLeagues:
      "Once one is, this board ranks your leagues' trade windows, soonest to close first, with each league's latest trade and how it graded.",
    newTrade: 'NEW TRADE',
    noDeadline: 'NO DEADLINE',
    deadlineUnknown: 'DEADLINE UNKNOWN',
    weekTag: (w: number) => `WEEK ${w}`,
    weeksLeft: (n: number) => `${n}W LEFT`,
    thisWeek: 'THIS WEEK',
    closed: 'CLOSED',
    openTrades: 'Open trades →',
    tradesOnFile: (n: number) => ` · ${n} ${n === 1 ? 'trade' : 'trades'} on file`,
    received: (name: string) => `${name} received`,
    nothingOnSide: 'Nothing on record for this side — FAAB only, or not captured.',
    pick: 'PICK',
    gradeFor: (name: string) => `${name} grade`,
    latestGrade: 'Latest grade',
    ungraded: (reason: string) => `ungraded: ${reason}`,
    noReason: 'no reason recorded',
    shareOfValue: 'Share of the value',
    latest: 'LATEST',
    weekOf: (w: number) => `week ${w}, `,
    waitingOnYou: 'Waiting on you',
    pending: (n: number) => `${n} pending`,
    youProposed: 'You proposed this',
    proposedToYou: 'Proposed to you',
    expires: (when: string) => ` · expires ${when}`,
    reviewIt: 'Review it →',
    onTheTable: 'On the table',
    sectionFresh: (n: number) => `Top ${n} · newest trades first, then leagues with trades, then deadline`,
    sectionTrades: (n: number) => `Top ${n} · leagues with trades first, then deadline`,
    sectionDeadline: (n: number) => `Top ${n} · ranked by deadline · no trades on file in any of them`,
    sectionNoDeadline: (n: number) => `Your ${n} ${n === 1 ? 'league' : 'leagues'} · no deadline ingested for any of them`,
    stillOpenWeek: (n: number, week: number) => `${n} still open · currently week ${week}`,
    stillOpen: (n: number) => `${n} still open`,
    noWindows: 'No team of yours is claimed in a league we can read a trade window for.',
    deadlineUnknownCount: (n: number) => `${n} of your leagues have never published a trade deadline.`,
    deadlineUnknownWhy: 'They sort below the ones that have — not because their window is open, but because we do not know when it shuts.',
    gradesNote:
      'Grades price both sides on this league’s own values. A completed trade keeps the grade it got the first time AllFantasy graded it, so it does not change as values move. A trade whose assets could not all be priced is shown with its reason instead of a letter — a “C” from no data would read as “an average trade”.',
    footerQuiet: 'have a window further out, or none we can read.',
  },
  es: {
    eyebrow: 'Core · Intercambios',
    title: 'Intercambios',
    blurb: 'Tus ventanas de intercambio, de la que cierra antes a la que cierra después, con el intercambio real más reciente de cada liga y su nota.',
    noLeagues:
      'Cuando haya una, este tablero ordenará las ventanas de intercambio de tus ligas, de la que cierra antes a la que cierra después, con el último intercambio de cada liga y su nota.',
    newTrade: 'NUEVO INTERCAMBIO',
    noDeadline: 'SIN FECHA LÍMITE',
    deadlineUnknown: 'FECHA LÍMITE DESCONOCIDA',
    weekTag: (w) => `SEMANA ${w}`,
    weeksLeft: (n) => `QUEDAN ${n} SEM.`,
    thisWeek: 'ESTA SEMANA',
    closed: 'CERRADO',
    openTrades: 'Ver intercambios →',
    tradesOnFile: (n) => ` · ${n} ${n === 1 ? 'intercambio registrado' : 'intercambios registrados'}`,
    received: (name) => (name === 'You' ? 'Tú recibiste' : `${name} recibió`),
    nothingOnSide: 'No hay nada registrado de este lado: solo FAAB o no se capturó.',
    pick: 'SELECCIÓN',
    gradeFor: (name) => (name === 'You' ? 'Tu nota' : `Nota de ${name}`),
    latestGrade: 'Última nota',
    ungraded: (reason) => `sin nota: ${reason}`,
    noReason: 'sin motivo registrado',
    shareOfValue: 'Parte del valor',
    latest: 'ÚLTIMO',
    weekOf: (w) => `semana ${w}, `,
    waitingOnYou: 'Esperan tu respuesta',
    pending: (n) => `${n} ${n === 1 ? 'pendiente' : 'pendientes'}`,
    youProposed: 'Lo propusiste tú',
    proposedToYou: 'Te lo propusieron',
    expires: (when) => ` · vence ${when}`,
    reviewIt: 'Revisarlo →',
    onTheTable: 'Sobre la mesa',
    sectionFresh: (n) => `Top ${n} · intercambios más recientes primero, luego ligas con intercambios, luego fecha límite`,
    sectionTrades: (n) => `Top ${n} · ligas con intercambios primero, luego fecha límite`,
    sectionDeadline: (n) => `Top ${n} · por fecha límite · ninguna tiene intercambios registrados`,
    sectionNoDeadline: (n) => `Tus ${n} ${n === 1 ? 'liga' : 'ligas'} · ninguna tiene fecha límite registrada`,
    stillOpenWeek: (n, week) => `${n} aún ${n === 1 ? 'abierta' : 'abiertas'} · semana actual ${week}`,
    stillOpen: (n) => `${n} aún ${n === 1 ? 'abierta' : 'abiertas'}`,
    noWindows: 'No tienes un equipo asignado en ninguna liga de la que podamos leer una ventana de intercambio.',
    deadlineUnknownCount: (n) => `${n} de tus ligas nunca han publicado una fecha límite de intercambios.`,
    deadlineUnknownWhy: 'Aparecen debajo de las que sí la tienen: no porque su ventana esté abierta, sino porque no sabemos cuándo cierra.',
    gradesNote:
      'Las notas valoran ambos lados con los valores propios de cada liga. Un intercambio completado conserva la nota que recibió la primera vez que AllFantasy lo calificó, así que no cambia cuando cambian los valores. Un intercambio cuyos activos no se pudieron valorar todos muestra el motivo en lugar de una letra: una «C» sin datos parecería «un intercambio normal».',
    footerQuiet: 'tienen una ventana más lejana o ninguna que podamos leer.',
  },
})

/**
 * The loader's status line (`TradeWindowRow.reasoning`), in the reader's language, sentence by
 * sentence. `translateReason` handles the grader's own withheld reason inside "The latest one is
 * ungraded: …". Unknown sentences stay as they are.
 */
export function statusLine(english: string, language: string, translateReason: (reason: string) => string = (r) => r): string {
  if (language !== 'es') return english
  const out: string[] = []
  let rest = english.trim()
  const take = (re: RegExp, say: (m: RegExpMatchArray) => string): boolean => {
    const m = rest.match(re)
    if (!m) return false
    out.push(say(m))
    rest = rest.slice(m[0].length).trim()
    return true
  }
  while (rest) {
    const matched =
      take(/^Trades stay open all season in this league\./, () => 'En esta liga los intercambios siguen abiertos toda la temporada.') ||
      take(/^The deadline is week (\d+)\./, (m) => `La fecha límite es la semana ${m[1]}.`) ||
      take(/^(\d+) weeks? until the week (\d+) deadline\./, (m) =>
        `${m[1] === '1' ? 'Queda 1 semana' : `Quedan ${m[1]} semanas`} para la fecha límite de la semana ${m[2]}.`) ||
      take(/^The deadline is this week \(week (\d+)\)\./, (m) => `La fecha límite es esta semana (semana ${m[1]}).`) ||
      take(/^The week (\d+) deadline has passed\./, (m) => `La fecha límite de la semana ${m[1]} ya pasó.`) ||
      take(/^This league has never published a trade deadline, so we do not know when it shuts\./, () =>
        'Esta liga nunca ha publicado una fecha límite de intercambios, así que no sabemos cuándo cierra.') ||
      take(/^(\d+) trades? on file here\./, (m) => `${m[1]} ${m[1] === '1' ? 'intercambio registrado' : 'intercambios registrados'} aquí.`) ||
      take(/^No trade has been made here on any season we hold\./, () => 'No hay intercambios aquí en ninguna temporada que tengamos.') ||
      take(/^(\d+) one-way moves? on file as well — Pirate steals, or a player sold for FAAB, which this list cannot tell apart\. They are not counted as trades here; the league's Trades list names each one\./, (m) =>
        `También ${m[1] === '1' ? 'hay 1 movimiento' : `hay ${m[1]} movimientos`} de un solo sentido: robos Pirate o un jugador vendido por FAAB, que esta lista no distingue. No se cuentan como intercambios aquí; la lista de intercambios de la liga nombra cada uno.`) ||
      take(/^The latest one is ungraded: (.+?)\.$/, (m) => `El último no tiene nota: ${translateReason(m[1]!)}.`)
    if (!matched) {
      out.push(rest)
      break
    }
  }
  return out.join(' ')
}

export const tradesBoardCopy = (language: string) => messagesFor(tradesBoardMessages, language)
