import { defineMessages } from '@/lib/i18n/messages'

/**
 * The /core/trades guide (AllLeaguesTradeHub in components/core-app/screens/TradeCenter.tsx,
 * lib/core-app/tradesGuide.ts).
 *
 * ⚠ SPANISH FOLLOWS THE APP'S WORDING RULINGS (__tests__/spanish-wording-rulings.test.tsx): a waiver
 * claim is «reclamo», the pool is «agentes libres», and no Spanish value says «waiver».
 */
export const tradesGuideMessages = defineMessages({
  en: {
    eyebrow: (leagues: number) => `Trades · ${leagues} ${leagues === 1 ? 'league' : 'leagues'}`,
    headOffers: (n: number) => `${n} trade ${n === 1 ? 'offer is' : 'offers are'} waiting for you`,
    headNew: (n: number) => `New trades in ${n} of your leagues this week`,
    headQuiet: 'No new trades in your leagues this week',
    headUnknown: 'Trades across your leagues',
    intro:
      'Check an offer before you accept it, see the deals made in your leagues and how they graded, and who’s rising or falling.',
    chipOffers: 'Offers waiting',
    chipNew: 'Leagues with new trades',
    chipDeadlines: 'Deadlines within a week',
    chipOpen: 'Leagues open to trade',
    why: 'Why it matters',

    checkTitle: 'Check a trade',
    checkSub: 'Pick a league, add what each side sends, and get a grade before you say yes.',
    checkTeach:
      'Grades use each league’s own scoring and rosters, so the same deal can be fair in one league and lopsided in another.',
    sleeperHint: 'Got an offer in Sleeper? Sleeper only shares trades once they’re accepted —',
    sleeperHintLink: 'upload a screenshot and we’ll grade it →',

    offersTitle: 'Offers waiting for you',
    offersChecking: (n: number) => `Checking ${n} ${n === 1 ? 'league' : 'leagues'} for offers…`,
    offersNone: (checked: number, total: number) =>
      checked >= total
        ? `No offers waiting in your ${total} ${total === 1 ? 'league' : 'leagues'}.`
        : `No offers waiting in the ${checked} ${checked === 1 ? 'league' : 'leagues'} checked so far.`,
    offersMore: (n: number) => `Check ${n} more ${n === 1 ? 'league' : 'leagues'}`,
    offersFailed: (n: number) => `Couldn’t check ${n} ${n === 1 ? 'league' : 'leagues'} — open ${n === 1 ? 'it' : 'one'} to see its offers.`,
    offersSleeper: 'Sleeper offers only show here after they’re accepted.',

    tradesTitle: 'Trades in your leagues',
    tradesSub: 'Newest trades first, with each league’s deadline and how its latest trade graded.',
    tradesTeach:
      'A trade that just happened changes who’s worth what in that league. See who got the better side before you make your own offer.',
    howGrades: 'How grades work',

    marketTitle: 'Who’s rising and falling',
    marketTeach:
      'These move with trades managers actually made, not opinions. Selling a player while he’s rising, or buying one after a drop, is where trade value comes from.',

    allLeagues: (n: number) => `All your leagues (${n})`,
    allLeaguesSub: 'Open one league’s trade page to see its offers, history and deadline.',
  },
  es: {
    eyebrow: (leagues: number) => `Intercambios · ${leagues} ${leagues === 1 ? 'liga' : 'ligas'}`,
    headOffers: (n: number) => `${n} ${n === 1 ? 'oferta de intercambio te espera' : 'ofertas de intercambio te esperan'}`,
    headNew: (n: number) => `Nuevos intercambios en ${n} de tus ligas esta semana`,
    headQuiet: 'No hay intercambios nuevos en tus ligas esta semana',
    headUnknown: 'Intercambios en tus ligas',
    intro:
      'Revisa una oferta antes de aceptarla, mira los intercambios de tus ligas y su calificación, y quién sube o baja.',
    chipOffers: 'Ofertas esperando',
    chipNew: 'Ligas con intercambios nuevos',
    chipDeadlines: 'Fechas límite en una semana',
    chipOpen: 'Ligas abiertas a intercambios',
    why: 'Por qué importa',

    checkTitle: 'Revisa un intercambio',
    checkSub: 'Elige una liga, añade lo que envía cada lado y recibe una calificación antes de aceptar.',
    checkTeach:
      'Las calificaciones usan la puntuación y las plantillas de cada liga, así que el mismo intercambio puede ser justo en una liga y desigual en otra.',
    sleeperHint: '¿Tienes una oferta en Sleeper? Sleeper solo comparte intercambios ya aceptados —',
    sleeperHintLink: 'sube una captura y la calificamos →',

    offersTitle: 'Ofertas que te esperan',
    offersChecking: (n: number) => `Revisando ofertas en ${n} ${n === 1 ? 'liga' : 'ligas'}…`,
    offersNone: (checked: number, total: number) =>
      checked >= total
        ? `No hay ofertas esperando en tus ${total} ${total === 1 ? 'liga' : 'ligas'}.`
        : `No hay ofertas esperando en las ${checked} ${checked === 1 ? 'liga revisada' : 'ligas revisadas'} hasta ahora.`,
    offersMore: (n: number) => `Revisar ${n} ${n === 1 ? 'liga más' : 'ligas más'}`,
    offersFailed: (n: number) => `No pudimos revisar ${n} ${n === 1 ? 'liga' : 'ligas'}; ábrela para ver sus ofertas.`,
    offersSleeper: 'Las ofertas de Sleeper solo aparecen aquí cuando ya se aceptaron.',

    tradesTitle: 'Intercambios en tus ligas',
    tradesSub: 'Los más recientes primero, con la fecha límite de cada liga y la calificación de su último intercambio.',
    tradesTeach:
      'Un intercambio reciente cambia lo que vale cada jugador en esa liga. Mira quién salió ganando antes de hacer tu propia oferta.',
    howGrades: 'Cómo funcionan las calificaciones',

    marketTitle: 'Quién sube y quién baja',
    marketTeach:
      'Se mueven con intercambios reales, no con opiniones. Vender a un jugador mientras sube, o comprarlo tras una caída, es de donde sale el valor.',

    allLeagues: (n: number) => `Todas tus ligas (${n})`,
    allLeaguesSub: 'Abre la página de intercambios de una liga para ver sus ofertas, historial y fecha límite.',
  },
})
