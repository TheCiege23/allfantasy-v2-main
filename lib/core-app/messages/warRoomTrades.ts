import { defineMessages } from '@/lib/i18n/messages'

/**
 * War Room trade ideas (components/core-app/screens/WarTradeIdeas.tsx).
 *
 * ⚠ EVERY NUMBER IS LINEUP ARITHMETIC OR THE OUTLOOK'S SIMULATION, AND THE COPY SAYS WHICH. "Does not
 * weaken their lineup" is a fact about projections, never a claim the other manager will accept.
 */
export const warRoomTradesMessages = defineMessages({
  en: {
    heading: 'Trades that move your odds',
    lockWhat: 'Trade ideas priced in playoff odds',
    basis: (week: number | null) =>
      `Each swap is priced on ${week == null ? 'this week’s' : `week ${week}`} projections in this league’s scoring and run through Season Outlook’s simulation. One projection week stands in for the rest of the season.`,
    sendGet: (send: string, receive: string, partner: string) => `Send ${send}, get ${receive} from ${partner}`,
    playoffDelta: (d: string) => `${d} playoff odds`,
    titleDelta: (d: string) => `${d} title odds`,
    notPriced: 'odds not priced',
    gains: (you: string, them: string) => `${you} pts/week for you · ${them} for them`,
    partnerFact: (pct: string) => `They’re at ${pct}% playoff odds.`,
    build: 'Build it in the Trade Center',
    noneFound: (n: number) =>
      `No 1-for-1 swap lifts your odds without weakening the other team’s lineup — ${n.toLocaleString('en-US')} checked.`,
    sellLead: 'Your veterans past their position’s usual decline age, and the teams they’d help most. Ask for young players and picks — the Trade Center prices the return.',
    sellPlayer: (name: string, pos: string | null, age: number | null, from: number) =>
      `${name}${pos ? `, ${pos}` : ''}${age != null ? `, age ${age}` : ''} (${pos ?? 'this position'} usually declines from ${from})`,
    sellPartner: (name: string, gain: string, pct: string | null) =>
      `${name}: ${gain} pts/week to their lineup${pct ? ` · ${pct}% playoff odds` : ''}`,
    sellNone: 'No veteran on your roster is past their position’s usual decline age with a team that would start them.',
    closed: (week: number) => `Trades closed after week ${week}. The offseason is the next window — plan who to move then.`,
    noneRedraftOut: 'Out of the race in a redraft league: nothing carries over, so there’s no trade worth making for next year.',
    noneNotPriced: (reason: string | null) => `Rosters in this league could not be priced${reason ? `: ${reason}` : '.'}`,
    noneNoTeam: 'We can’t tell which team in this league is yours, so there’s nothing to trade from.',
    noneUnplaced: 'This team isn’t placed yet (too few weeks played, or a format Season Outlook can’t simulate), so trades can’t be priced in odds.',
  },
  es: {
    heading: 'Cambios que mueven tus probabilidades',
    lockWhat: 'Ideas de cambio valoradas en probabilidad de playoffs',
    basis: (week) =>
      `Cada cambio se valora con las proyecciones de ${week == null ? 'esta semana' : `la semana ${week}`} con la puntuación de esta liga y se pasa por la simulación de Perspectiva de temporada. Una semana de proyección representa el resto de la temporada.`,
    sendGet: (send, receive, partner) => `Envía a ${send}, recibe a ${receive} de ${partner}`,
    playoffDelta: (d) => `${d} prob. de playoffs`,
    titleDelta: (d) => `${d} prob. de título`,
    notPriced: 'probabilidades sin valorar',
    gains: (you, them) => `${you} pts/semana para ti · ${them} para ellos`,
    partnerFact: (pct) => `Están en ${pct}% de probabilidad de playoffs.`,
    build: 'Arma el cambio en el Centro de cambios',
    noneFound: (n) =>
      `Ningún cambio 1 por 1 sube tus probabilidades sin debilitar la alineación del otro equipo — ${n.toLocaleString('es')} revisados.`,
    sellLead: 'Tus veteranos que pasaron la edad en que su posición suele decaer, y los equipos a los que más ayudarían. Pide jugadores jóvenes y selecciones — el Centro de cambios valora lo que recibes.',
    sellPlayer: (name, pos, age, from) =>
      `${name}${pos ? `, ${pos}` : ''}${age != null ? `, ${age} años` : ''} (${pos ?? 'esta posición'} suele decaer desde los ${from})`,
    sellPartner: (name, gain, pct) => `${name}: ${gain} pts/semana para su alineación${pct ? ` · ${pct}% prob. de playoffs` : ''}`,
    sellNone: 'Ningún veterano de tu plantel pasó la edad de declive de su posición con un equipo que lo pondría de titular.',
    closed: (week) => `Los cambios cerraron después de la semana ${week}. La pretemporada es la próxima ventana — planea a quién mover entonces.`,
    noneRedraftOut: 'Fuera de carrera en una liga redraft: nada se conserva, así que no hay cambio que valga la pena para el próximo año.',
    noneNotPriced: (reason) => `No se pudieron valorar los planteles de esta liga${reason ? `: ${reason}` : '.'}`,
    noneNoTeam: 'No sabemos cuál equipo de esta liga es el tuyo, así que no hay desde dónde cambiar.',
    noneUnplaced: 'Este equipo aún no está ubicado (muy pocas semanas jugadas, o un formato que Perspectiva de temporada no puede simular), así que los cambios no se pueden valorar en probabilidades.',
  },
})
