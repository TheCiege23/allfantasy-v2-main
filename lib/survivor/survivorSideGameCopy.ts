/**
 * Server copy for Exile Island and the side games, in English and Spanish, picked by
 * `League.language` like every other Survivor message. Pure and client-safe.
 */
import { defineMessages, messagesFor } from '@/lib/i18n/messages'

export const survivorSideGameCopy = defineMessages({
  en: {
    notSurvivor: 'This is not a Survivor league.',
    notCastaway: 'Only castaways in this season can play.',
    onlyExiles: 'Only managers on Exile Island can play the Token Pool.',
    onlyActive: 'Only castaways still on the island can play this.',
    tokenPoolOff: 'The Token Pool is not running in this league.',
    tokenPoolClosed: 'The commissioner has closed the Token Pool for now.',
    tokenPoolLimit: (n: number): string => `You have used your ${n} Token Pool ${n === 1 ? 'pick' : 'picks'} this week.`,
    alreadyPicked: 'You already picked that game.',
    gameNotFound: 'That game is not on this week’s slate.',
    gameLocked: 'That game has already kicked off.',
    teamNotInGame: 'Pick one of the two teams in that game.',
    nothingToCashOut: 'You have no streak tokens to bank.',
    notStreak: 'This league’s Token Pool has no streak to cash out.',
    poolOff: 'The Survivor Pool is not running in this league.',
    poolNotStarted: (w: number): string => `The Survivor Pool starts in week ${w}.`,
    poolOut: 'You are out of the Survivor Pool this week. Use a revive to get back in.',
    poolBanned: 'You have used every revive and are banned from the Survivor Pool.',
    poolPickLocked: 'Your pick for this week has already kicked off.',
    poolNotInConference: (c: string): string => `This week you must pick a team from the ${c}.`,
    poolNotAway: 'This week you must pick a team playing away.',
    poolNotAllowed: 'That team is not on this week’s allowed list.',
    poolConferenceUnknown: 'This week’s conference rule only applies to NFL teams.',
    poolNoRevive: 'You have no revives left.',
    poolStillIn: 'You are still in the pool.',
    auctionNotFound: 'That auction was not found.',
    auctionNotOpen: 'That auction is not taking bids right now.',
    auctionItemNotFound: 'That item is not in this auction.',
    bidTooLow: (n: number): string => `Bid more than the current high bid of ${n}.`,
    bidOverBalance: (n: number): string => `You only have ${n} to bid with.`,
    bidLocked: 'Sealed bids lock: you already bid on this item.',
    bidNotWhole: 'Bid a whole number of at least 1.',
    shopClosed: 'The token shop is closed.',
    shopNotForSale: 'That item is not for sale.',
    shopNotEnough: (cost: number, have: number): string => `That costs ${cost} ${cost === 1 ? 'token' : 'tokens'}; you have ${have}.`,
    shopPending: 'Bought. It is delivered the moment you are back on the island.',
    exileBidsOff: 'Exile teams are claimed first-come in this league.',
    exileBidsClosed: 'Team bidding has closed for this Exile period; claim an open team instead.',
    exileBidOverBudget: (n: number): string => `Your Exile bid budget is ${n}.`,
    exileBidTeamUnknown: 'That team has no game left to play this Exile period.',
    exileBiddingOpen: (when: string): string => `Teams are won by sealed bid until ${when}. Place a bid, or claim an open team after bidding closes.`,
    exileAwardedOther: (team: string): string => `You won ${team} in the bidding; claim players from that team.`,
    invalid: 'That request is not valid.',
    returnFaab: (name: string, faab: number, tokens: number): string => `${name} cashed in ${tokens} ${tokens === 1 ? 'token' : 'tokens'} for $${faab} FAAB on their return.`,
  },
  es: {
    notSurvivor: 'Esta no es una liga Survivor.',
    notCastaway: 'Solo los náufragos de esta temporada pueden jugar.',
    onlyExiles: 'Solo los mánagers en la Isla del Exilio pueden jugar el Pozo de Fichas.',
    onlyActive: 'Solo los náufragos que siguen en la isla pueden jugar esto.',
    tokenPoolOff: 'El Pozo de Fichas no está activo en esta liga.',
    tokenPoolClosed: 'El comisionado cerró el Pozo de Fichas por ahora.',
    tokenPoolLimit: (n: number): string => `Ya usaste ${n === 1 ? 'tu elección' : `tus ${n} elecciones`} del Pozo de Fichas esta semana.`,
    alreadyPicked: 'Ya elegiste ese partido.',
    gameNotFound: 'Ese partido no está en la jornada de esta semana.',
    gameLocked: 'Ese partido ya empezó.',
    teamNotInGame: 'Elige uno de los dos equipos de ese partido.',
    nothingToCashOut: 'No tienes fichas de racha para guardar.',
    notStreak: 'El Pozo de Fichas de esta liga no tiene racha para cobrar.',
    poolOff: 'El Pozo Survivor no está activo en esta liga.',
    poolNotStarted: (w: number): string => `El Pozo Survivor empieza en la semana ${w}.`,
    poolOut: 'Estás fuera del Pozo Survivor esta semana. Usa una resurrección para volver.',
    poolBanned: 'Usaste todas tus resurrecciones y quedaste fuera del Pozo Survivor.',
    poolPickLocked: 'Tu elección de esta semana ya empezó.',
    poolNotInConference: (c: string): string => `Esta semana debes elegir un equipo de la ${c}.`,
    poolNotAway: 'Esta semana debes elegir un equipo que juegue de visitante.',
    poolNotAllowed: 'Ese equipo no está en la lista permitida de esta semana.',
    poolConferenceUnknown: 'La regla de conferencia de esta semana solo aplica a equipos de la NFL.',
    poolNoRevive: 'No te quedan resurrecciones.',
    poolStillIn: 'Sigues en el pozo.',
    auctionNotFound: 'No se encontró esa subasta.',
    auctionNotOpen: 'Esa subasta no acepta pujas ahora.',
    auctionItemNotFound: 'Ese artículo no está en esta subasta.',
    bidTooLow: (n: number): string => `Puja más que la puja más alta actual de ${n}.`,
    bidOverBalance: (n: number): string => `Solo tienes ${n} para pujar.`,
    bidLocked: 'Las pujas cerradas no se cambian: ya pujaste por este artículo.',
    bidNotWhole: 'Puja un número entero de al menos 1.',
    shopClosed: 'La tienda de fichas está cerrada.',
    shopNotForSale: 'Ese artículo no está a la venta.',
    shopNotEnough: (cost: number, have: number): string => `Cuesta ${cost} ${cost === 1 ? 'ficha' : 'fichas'}; tienes ${have}.`,
    shopPending: 'Comprado. Se entrega en cuanto vuelvas a la isla.',
    exileBidsOff: 'En esta liga los equipos del Exilio se toman por orden de llegada.',
    exileBidsClosed: 'Las pujas por equipos cerraron en este periodo del Exilio; toma un equipo libre.',
    exileBidOverBudget: (n: number): string => `Tu presupuesto de pujas del Exilio es ${n}.`,
    exileBidTeamUnknown: 'A ese equipo no le queda partido en este periodo del Exilio.',
    exileBiddingOpen: (when: string): string => `Los equipos se ganan por puja cerrada hasta ${when}. Puja, o toma un equipo libre cuando cierren las pujas.`,
    exileAwardedOther: (team: string): string => `Ganaste ${team} en las pujas; elige jugadores de ese equipo.`,
    invalid: 'Esa solicitud no es válida.',
    returnFaab: (name: string, faab: number, tokens: number): string => `${name} cambió ${tokens} ${tokens === 1 ? 'ficha' : 'fichas'} por $${faab} de FAAB al volver.`,
  },
})

export type SurvivorSideGameCopy = typeof survivorSideGameCopy.en

export function sideGameCopy(language: string | null | undefined): SurvivorSideGameCopy {
  return messagesFor(survivorSideGameCopy, String(language ?? '').toLowerCase().startsWith('es') ? 'es' : 'en')
}

/** "Wed 9:00 PM ET" / "mié 21:00 ET". */
export function easternWhen(at: Date, language: string | null | undefined): string {
  const es = String(language ?? '').toLowerCase().startsWith('es')
  const text = new Intl.DateTimeFormat(es ? 'es-US' : 'en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(at)
  return `${text} ET`
}
