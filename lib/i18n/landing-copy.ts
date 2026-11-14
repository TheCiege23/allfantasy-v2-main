/**
 * Landing-page copy, in English and Spanish.
 *
 * ⚠ DELIBERATELY SEPARATE FROM `lib/i18n/translations`. That map is consumed by
 * `LanguageProviderClient`, which resolves the active language from localStorage
 * inside an effect — a client-only mechanism. The landing page is the one surface
 * whose text has to exist in the server response: it carries the SEO and every
 * link preview. Copy that only appears after hydration is copy a crawler never
 * sees, so the landing reads its strings from this module at render time and the
 * language arrives as a prop from the route's `searchParams`.
 *
 * The language therefore lives in the URL (`/?lang=es`), which also makes it a
 * real, shareable, indexable address rather than a per-browser preference.
 *
 * 2026-11-13 SIMPLIFICATION. The page said "every league in one place" four times (hero, the
 * Chimmy band, the three steps, the three reasons). Those four sections are now one: "What you
 * get". Added: the commissioner band, game-day player search and a three-tab demo.
 */

import type { MonthlyPriceRange } from '@/lib/monetization/planPresentation'
import type { ImportProvider } from '@/lib/league-import/types'
import { getLandingLivePlatformNames } from '@/components/core-app/screens/landingConnectPlatforms'
import { FREE_CHIMMY_QUESTIONS_PER_DAY } from '@/lib/tokens/freeChimmyQuestions'

export const LANDING_LANGS = ['en', 'es'] as const
export type LandingLang = (typeof LANDING_LANGS)[number]

export const DEFAULT_LANDING_LANG: LandingLang = 'en'

/** Narrows an untrusted `?lang=` value; anything unrecognised falls back to English. */
export function resolveLandingLang(raw: string | string[] | undefined): LandingLang {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return DEFAULT_LANDING_LANG
  // Accept regional tags (es-MX, es-419, en-US) rather than only the bare code —
  // a link shared with a full locale should not silently render the wrong language.
  const base = value.toLowerCase().split('-')[0]
  return (LANDING_LANGS as readonly string[]).includes(base)
    ? (base as LandingLang)
    : DEFAULT_LANDING_LANG
}

/*
 * 🛑 NO PLATFORM IS NAMED IN A SENTENCE BY HAND. The copy said "Connect Sleeper and ESPN" in the
 * hero, the meta description, a reason card and the first FAQ answer while five platforms were
 * live — the same drift the "Connects to" strip had before it was derived (see
 * landingConnectPlatforms.ts). Every sentence that lists platforms now reads the live list, so the
 * day a platform flips on or off, every sentence follows.
 *
 * Sleeper is the one platform named on its own, and only for a fact about Sleeper: it imports from
 * a username alone ("No password, ever" — the import screen's own promise, ImportV4.tsx). ESPN
 * private leagues and MFL need more than that, so the claim is never widened to "every platform".
 */
function joinList(items: string[], lang: LandingLang): string {
  return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' }).format(items)
}

const LIVE_PLATFORMS = getLandingLivePlatformNames()

type Item = { title: string; body: string }
type GameDayLeague = { name: string; meta: string; state: string; tone: 'bad' | 'good'; action: string | null }
/**
 * `aboutPrice`: the answer quotes plan prices, so LandingV4 keeps it out of the iOS app, which
 * sells nothing (App Store 3.1.1). The FAQPage structured data still carries it — crawlers are
 * not the app.
 */
type Faq = { q: string; a: string; aboutPrice?: true }
type NetworkCard = { name: string; body: string }

type LandingCopy = {
  /** Value for the document's `lang` attribute and the OpenGraph locale. */
  htmlLang: string
  ogLocale: string
  meta: { title: string; description: string; ogTitle: string; ogDescription: string }
  nav: {
    how: string
    gameDay: string
    demo: string
    pricing: string
    forCommissioners: string
    signIn: string
    /** Primary CTA when the reader is already signed in. */
    goToDashboard: string
    partners: string
    /** The signed-out primary CTA. Says "sign up" so it reads as a pair with "Sign in". */
    getStarted: string
    /**
     * The phone bar's labels. Measured 2026-11-13: «Iniciar sesión» + «Regístrate gratis» pushed
     * the menu button off a 390px screen, so the bar carries short forms in both languages.
     */
    signInShort: string
    getStartedShort: string
    langLabel: string
    menuLabel: string
  }
  hero: {
    eyebrow: string
    h1a: string
    h1b: string
    sub: string
    ctaPrimary: string
    /** Opens the public, anonymized demo league (/demo). No account needed. */
    ctaDemo: string
    /** "Already have an account?" — followed by the Sign in link. */
    haveAccount: string
    cardTitle: string
    cardWeek: string
    /** Precedes the example uplift figure, e.g. "Two fixes worth " + "+13.0". */
    cardFootBefore: string
    /** Second line under it — who produced the figure and over what. */
    cardFootMeta: string
  }
  /**
   * The commissioner band. Every tool named here is LIVE on /commissioners (commissionersCopy.ts):
   * the dues tracker, league-aware trade grades and the pre-kickoff lineup check. Nothing from that
   * page's roadmap belongs here.
   */
  commish: {
    label: string
    /** The bold headline. Rendered as a link-carrying line with data-testid="landing-commish-line". */
    h2: string
    body: string
    items: Item[]
    ctaPrimary: string
    ctaSecondary: string
  }
  /** "What you get" — the #how anchor. Four things, said once each. */
  get: { h2: string; body: string; items: Item[] }
  /**
   * Game day: the player finder's game-day mode (PlayerFinder.tsx — pregameInactive, LockClock,
   * SwapCandidates). The card is an EXAMPLE and says so; every element in it is something the
   * finder really shows: injury status and report time, Inactive inside the last two hours, the
   * lock clock, every league he is in, and the swap.
   */
  gameDay: {
    badge: string
    h2: string
    body: string
    steps: string[]
    cta: string
    exampleLabel: string
    searchLabel: string
    playerName: string
    playerMeta: string
    status: string
    statusNote: string
    lockValue: string
    lockLabel: string
    lockMeta: string
    trackReport: string
    trackNow: string
    trackLock: string
    leaguesLabel: string
    leagues: GameDayLeague[]
    chimmyLabel: string
    chimmy: string
  }
  /** "See it before you sign up" — three tabs, each opening a real no-account surface. */
  demo: {
    h2: string
    body: string
    tabsLabel: string
    tabLeagues: string
    tabTrade: string
    tabTypes: string
    leaguesBody: string
    leaguesRows: { name: string; tag: string; tone: 'bad' | 'warn' | 'good' }[]
    leaguesCta: string
    typesBody: string
    typesCta: string
  }
  /** The live AllFantasy trade market board — values from completed trades in connected leagues. */
  tradeMarket: {
    heading: string
    cta: string
  }
  /**
   * Two sport lists under two labels: what IMPORTS today (football) and what a league CREATED here
   * can run (all seven). One unlabelled list under "Connects to" read as an import claim.
   */
  connects: {
    label: string
    soon: string
    importLabel: string
    createLabel: string
    soccer: string
    /**
     * Why a "soon" platform is not live, keyed by provider. Rendered only while the import config
     * still marks that provider unavailable, so flipping the flag retires the sentence with it.
     */
    soonNotes: Partial<Record<ImportProvider, string>>
  }
  pricing: { h2: string; body: string; ctaPrimary: string; ctaSecondary: string }
  faq: { h2: string; items: Faq[] }
  /** A single footer line now — a full section of links to other products sat before the last CTA. */
  network: { label: string; cards: NetworkCard[] }
  footer: {
    playerFinder: string
    dashboard: string
    privacy: string
    terms: string
    dataDeletion: string
    /** "Do Not Sell or Share" — Privacy Policy 5.3; the page is /privacy/choices. */
    privacyChoices: string
    builtByLabel: string
    compliance: string
  }
}

const EN = (prices: MonthlyPriceRange | null): LandingCopy => {
  const platforms = joinList(LIVE_PLATFORMS, 'en')
  return {
    htmlLang: 'en',
    ogLocale: 'en_US',
    meta: {
      title: 'AllFantasy.ai — Fantasy Leagues, Tools & AI Help in One Place',
      description: `Create a fantasy league or connect ${platforms}. Manage teams, drafts, trades and waivers in one place, with AI help from Chimmy when you need it.`,
      ogTitle: 'AllFantasy.ai — Play Fantasy Sports in One Place',
      ogDescription: 'Create or connect fantasy leagues, manage your teams and get AI help for your next move.',
    },
    nav: {
      how: 'What you get',
      gameDay: 'Game day',
      demo: 'Demo',
      pricing: 'Pricing',
      forCommissioners: 'For commissioners',
      signIn: 'Sign in',
      goToDashboard: 'Go to dashboard',
      partners: 'Partners',
      getStarted: 'Sign up free',
      signInShort: 'Sign in',
      getStartedShort: 'Sign up',
      langLabel: 'Language',
      menuLabel: 'Open navigation menu',
    },
    hero: {
      // What it IS first. "Fantasy sports only · no gambling" told a stranger what it was not.
      eyebrow: 'Your fantasy sports home',
      h1a: 'Play fantasy sports.',
      h1b: 'All in one place.',
      sub: `Bring in your leagues from ${platforms}, or create a new one. Free for every league.`,
      ctaPrimary: 'Sign up free',
      ctaDemo: 'Try the demo',
      haveAccount: 'Already have an account?',
      cardTitle: 'Your leagues',
      cardWeek: 'Week 12 · example',
      cardFootBefore: 'Two fixes worth ',
      cardFootMeta: 'Chimmy, across all 4 leagues',
    },
    commish: {
      label: 'For commissioners',
      h2: 'Built by a long-time commissioner, for commissioners.',
      body: 'Years of running leagues taught us what breaks: chasing dues, lopsided trades and empty lineups at kickoff. AllFantasy handles all three.',
      items: [
        {
          title: 'Dues tracker',
          body: 'Set the amount and due date and see who has paid at a glance. AllFantasy never holds or moves league money.',
        },
        {
          title: 'Trade grades for your league',
          body: 'Trades are graded on how your league actually works, not a generic value chart.',
        },
        {
          title: 'Lineup checks before kickoff',
          body: 'A manager with an empty slot or a starter ruled out gets a check from Chimmy before the game, so you do not have to chase them.',
        },
      ],
      ctaPrimary: 'See commissioner tools',
      ctaSecondary: 'Start a league free',
    },
    get: {
      h2: 'What you get, free',
      body: 'Every league you bring in or create is free, with drafts, trades, waivers and live scoring.',
      items: [
        {
          title: 'Every league on one board',
          body: 'One Sunday view instead of a tab per app, with what needs you first.',
        },
        {
          title: 'Game-day player search',
          body: 'Check a player right before kickoff and see every league you have him in.',
        },
        {
          title: 'Trade grades from real trades',
          body: 'Values come from trades managers actually made, not votes, and update daily.',
        },
        {
          title: 'Chimmy, your AI assistant',
          body: `Ask about your real rosters. Free accounts get ${FREE_CHIMMY_QUESTIONS_PER_DAY} questions a day.`,
        },
      ],
    },
    gameDay: {
      badge: 'Game day',
      h2: 'Is he playing? Know before kickoff.',
      body: 'Search any player in the hours before his game. See his latest status, every league you have him in, and the swap to make if he is out.',
      steps: ['Search a name', 'See his status and the time left to lock', 'Make the swap in each league'],
      cta: 'Search a player',
      exampleLabel: 'Example',
      searchLabel: 'Player search',
      playerName: 'Theo Banks',
      playerMeta: 'RB · kickoff 1:00 PM',
      status: 'Inactive',
      statusNote: 'Ruled out at 11:40 AM',
      lockValue: '41m',
      lockLabel: 'to lineup lock',
      lockMeta: 'Locks at kickoff, 1:00 PM',
      trackReport: 'Out · 11:40',
      trackNow: 'Now · 12:19',
      trackLock: 'Lock · 1:00',
      leaguesLabel: 'In your leagues',
      leagues: [
        { name: 'Dynasty Dragons', meta: 'Sleeper · RB2', state: 'Starting', tone: 'bad', action: 'Swap in Cole' },
        { name: 'Gridiron Gang', meta: 'ESPN · FLEX', state: 'Starting', tone: 'bad', action: 'Swap in Ruiz' },
        { name: 'End Zone Elites', meta: 'Fantrax · Bench', state: 'On bench', tone: 'good', action: null },
      ],
      chimmyLabel: 'Chimmy',
      chimmy: 'He is out. Two of your lineups start him, and your bench has a healthy RB for each one.',
    },
    demo: {
      h2: 'See it before you sign up',
      body: 'Example leagues and live trade values. No account needed.',
      tabsLabel: 'Demo views',
      tabLeagues: 'Your leagues',
      tabTrade: 'Trade grade',
      tabTypes: 'League types',
      leaguesBody: 'A full demo league: your board, lineups, waivers and trades, with what needs you first.',
      leaguesRows: [
        { name: 'Empty flex in Dynasty Dragons', tag: 'Set lineup', tone: 'bad' },
        { name: 'Waivers run tonight in Gridiron Gang', tag: 'Waivers', tone: 'warn' },
        { name: 'End Zone Elites is ready', tag: 'All set', tone: 'good' },
      ],
      leaguesCta: 'Open the demo league',
      typesBody: 'See an example league for every league type before you start one.',
      typesCta: 'See every league type',
    },
    tradeMarket: {
      heading: 'Trade values built from real trades',
      cta: 'Grade a trade free',
    },
    connects: {
      label: 'Connects to',
      soon: 'soon',
      importLabel: 'Imports',
      createLabel: 'Create a league',
      soccer: 'SOCCER',
      // Yahoo gates its Fantasy Sports API behind an approval (provider-ui-config.ts records it).
      soonNotes: { yahoo: 'Yahoo is coming soon — we’re waiting on Yahoo to approve our access.' },
    },
    pricing: {
      // ⚠ NOT "Upgrade to act on it" and NOT "free for players": creating, importing and
      // RUNNING leagues is free for players and commissioners alike (the Oct 15 paywall rule),
      // so the paid line is the edge on top — never the league itself.
      h2: 'Every league is free. Upgrade for the edge.',
      body: prices
        ? `Create, import and run as many leagues as you want, free. Paid plans from ${prices.min}/mo add more Chimmy, deeper trade and player analysis, and commissioner automation.`
        : 'Create, import and run as many leagues as you want, free. Paid plans add more Chimmy, deeper trade and player analysis, and commissioner automation.',
      ctaPrimary: 'Sign up free',
      ctaSecondary: 'Compare plans',
    },
    faq: {
      h2: 'Questions managers ask',
      items: [
        {
          q: 'Which leagues can I bring in?',
          a: `${platforms} — read-only, and Sleeper needs only your username. We copy your real rosters, matchups and scoring, and never change anything on the platform. You can also start a new league here, free.`,
        },
        {
          q: 'How does the game-day player search work?',
          a: 'Search a player once and see every league you roster him in, his slot and injury status, the time left before lineups lock, and the swap to make in each.',
        },
        {
          q: 'Is AllFantasy gambling or DFS?',
          a: 'No. AllFantasy is 100% season-long fantasy sports. No sportsbook, no daily fantasy.',
        },
        {
          q: 'What does it cost?',
          a: prices
            ? `Creating, importing and running leagues is free forever. Paid plans run ${prices.min}–${prices.max}/mo and can be cancelled anytime.`
            : 'Creating, importing and running leagues is free forever. Every paid plan can be cancelled anytime.',
          aboutPrice: true,
        },
      ],
    },
    network: {
      label: 'More from Brown Pig LLC',
      cards: [
        { name: 'Gooby', body: 'Social discovery for people and their dogs.' },
        { name: 'Cafe Con Chimmy', body: 'Culture, coffee and conversation from the Chimmy world.' },
        { name: 'Parent Playbook', body: 'Practical plays for parents, one situation at a time.' },
        { name: 'PetPass', body: 'Every pet record, vet visit and reminder in one pass.' },
        { name: 'SideQuest', body: 'Turn the side hustle into a tracked, finishable quest.' },
        { name: 'StoryVault', body: 'Record and keep the family stories before they are gone.' },
      ],
    },
    footer: {
      playerFinder: 'Player finder',
      dashboard: 'Dashboard',
      privacy: 'Privacy',
      terms: 'Terms',
      dataDeletion: 'Data deletion',
      privacyChoices: 'Do Not Sell or Share My Personal Information',
      builtByLabel: 'Built by',
      compliance:
        'Not available in WA. Paid leagues restricted in HI, ID, MT, NV. 100% fantasy sports — no gambling, no DFS.',
    },
  }
}

/*
 * ⚠ THE SPANISH IS WRITTEN, NOT TRANSLATED WORD-FOR-WORD. Fantasy vocabulary in
 * US Spanish keeps the English terms in daily use — "draft", "roster", "lineup" —
 * and calquing them ("alineación") reads as machine output to exactly the audience
 * this page is for. The one exception is the waiver vocabulary, by the owner's
 * ruling (2026-10-06): a claim is «reclamo», a run «procesamiento de reclamos» and
 * the wire / the players «agentes libres», as everywhere else in the app.
 * Product nouns (AllFantasy, Decision OS, Chimmy, Sleeper/ESPN/Yahoo) are names
 * and stay.
 *
 * ⚠ THE COMPLIANCE LINE IS A LEGAL STATEMENT, NOT MARKETING. It carries the same
 * restriction in both languages — the state list and the "no gambling, no DFS"
 * claim — because softening either one would make the page promise Spanish
 * readers something different from what it promises English ones.
 */
const ES = (prices: MonthlyPriceRange | null): LandingCopy => {
  const platforms = joinList(LIVE_PLATFORMS, 'es')
  return {
    htmlLang: 'es',
    ogLocale: 'es_US',
    meta: {
      title: 'AllFantasy.ai — Ligas, herramientas y ayuda de IA en un solo lugar',
      description: `Crea una liga de fantasy o conecta ${platforms}. Maneja tus equipos, drafts, cambios y agentes libres en un solo lugar, con ayuda de Chimmy cuando la necesites.`,
      ogTitle: 'AllFantasy.ai — Juega fantasy en un solo lugar',
      ogDescription: 'Crea o conecta ligas de fantasy, maneja tus equipos y recibe ayuda de IA para tu siguiente jugada.',
    },
    nav: {
      how: 'Qué incluye',
      gameDay: 'Día de juego',
      demo: 'Demo',
      pricing: 'Precios',
      forCommissioners: 'Para comisionados',
      signIn: 'Iniciar sesión',
      goToDashboard: 'Ir al panel',
      partners: 'Socios',
      getStarted: 'Regístrate gratis',
      signInShort: 'Entrar',
      getStartedShort: 'Regístrate',
      langLabel: 'Idioma',
      menuLabel: 'Abrir el menú',
    },
    hero: {
      eyebrow: 'Tu hogar para fantasy',
      h1a: 'Juega fantasy.',
      h1b: 'Todo en un lugar.',
      sub: `Trae tus ligas de ${platforms}, o crea una nueva. Gratis para todas tus ligas.`,
      ctaPrimary: 'Regístrate gratis',
      ctaDemo: 'Prueba la demo',
      haveAccount: '¿Ya tienes cuenta?',
      cardTitle: 'Tus ligas',
      cardWeek: 'Semana 12 · ejemplo',
      cardFootBefore: 'Dos ajustes que valen ',
      cardFootMeta: 'Chimmy, en las 4 ligas',
    },
    commish: {
      label: 'Para comisionados',
      h2: 'Hecho por un comisionado de muchos años, para comisionados.',
      body: 'Años dirigiendo ligas nos enseñaron qué falla: cobrar las cuotas, los cambios desiguales y los lineups vacíos a la hora del partido. AllFantasy se encarga de los tres.',
      items: [
        {
          title: 'Control de cuotas',
          body: 'Pon el monto y la fecha límite y mira quién ya pagó de un vistazo. AllFantasy nunca guarda ni mueve el dinero de la liga.',
        },
        {
          title: 'Calificación de cambios para tu liga',
          body: 'Los cambios se califican según cómo funciona tu liga, no con una tabla de valores genérica.',
        },
        {
          title: 'Revisión de lineups antes del partido',
          body: 'Si un manager tiene un lugar vacío o un titular descartado, Chimmy le avisa antes del partido, y tú no tienes que perseguirlo.',
        },
      ],
      ctaPrimary: 'Ver herramientas para comisionados',
      ctaSecondary: 'Crea una liga gratis',
    },
    get: {
      h2: 'Qué incluye, gratis',
      body: 'Todas las ligas que traigas o crees son gratis, con drafts, cambios, agentes libres y marcadores en vivo.',
      items: [
        {
          title: 'Todas tus ligas en un tablero',
          body: 'Una sola vista el domingo en vez de una pestaña por app, con lo que te necesita primero.',
        },
        {
          title: 'Búsqueda de jugadores el día de juego',
          body: 'Revisa a un jugador justo antes del partido y mira todas las ligas donde lo tienes.',
        },
        {
          title: 'Calificaciones con cambios reales',
          body: 'Los valores salen de cambios que los managers sí hicieron, no de votos, y se actualizan a diario.',
        },
        {
          title: 'Chimmy, tu asistente de IA',
          body: `Pregunta sobre tus rosters reales. Las cuentas gratis tienen ${FREE_CHIMMY_QUESTIONS_PER_DAY} preguntas al día.`,
        },
      ],
    },
    gameDay: {
      badge: 'Día de juego',
      h2: '¿Va a jugar? Sábelo antes del partido.',
      body: 'Busca a cualquier jugador en las horas antes de su partido. Mira su estado más reciente, todas las ligas donde lo tienes y el cambio que debes hacer si no juega.',
      steps: ['Busca un nombre', 'Mira su estado y cuánto falta para el cierre', 'Haz el cambio en cada liga'],
      cta: 'Buscar un jugador',
      exampleLabel: 'Ejemplo',
      searchLabel: 'Buscar jugador',
      playerName: 'Theo Banks',
      playerMeta: 'RB · partido 1:00 PM',
      status: 'Inactivo',
      statusNote: 'Descartado a las 11:40 AM',
      lockValue: '41m',
      lockLabel: 'para el cierre del lineup',
      lockMeta: 'Cierra al inicio del partido, 1:00 PM',
      trackReport: 'Out · 11:40',
      trackNow: 'Ahora · 12:19',
      trackLock: 'Cierre · 1:00',
      leaguesLabel: 'En tus ligas',
      leagues: [
        { name: 'Dynasty Dragons', meta: 'Sleeper · RB2', state: 'Titular', tone: 'bad', action: 'Poner a Cole' },
        { name: 'Gridiron Gang', meta: 'ESPN · FLEX', state: 'Titular', tone: 'bad', action: 'Poner a Ruiz' },
        { name: 'End Zone Elites', meta: 'Fantrax · Banca', state: 'En la banca', tone: 'good', action: null },
      ],
      chimmyLabel: 'Chimmy',
      chimmy: 'No va a jugar. Dos de tus lineups lo tienen de titular, y tu banca tiene un RB sano para cada uno.',
    },
    demo: {
      h2: 'Míralo antes de registrarte',
      body: 'Ligas de ejemplo y valores de cambios en vivo. Sin cuenta.',
      tabsLabel: 'Vistas de la demo',
      tabLeagues: 'Tus ligas',
      tabTrade: 'Calificar un cambio',
      tabTypes: 'Tipos de liga',
      leaguesBody: 'Una liga de demo completa: tu tablero, lineups, agentes libres y cambios, con lo que te necesita primero.',
      leaguesRows: [
        { name: 'FLEX vacío en Dynasty Dragons', tag: 'Pon tu lineup', tone: 'bad' },
        { name: 'Reclamos esta noche en Gridiron Gang', tag: 'Reclamos', tone: 'warn' },
        { name: 'End Zone Elites está lista', tag: 'Todo listo', tone: 'good' },
      ],
      leaguesCta: 'Abrir la liga de demo',
      typesBody: 'Mira una liga de ejemplo de cada tipo antes de crear la tuya.',
      typesCta: 'Ver todos los tipos de liga',
    },
    tradeMarket: {
      heading: 'Valores de intercambio basados en intercambios reales',
      cta: 'Evalúa un intercambio gratis',
    },
    connects: {
      label: 'Se conecta con',
      soon: 'pronto',
      importLabel: 'Importa',
      createLabel: 'Crea una liga',
      soccer: 'FÚTBOL',
      soonNotes: { yahoo: 'Yahoo llega pronto: estamos esperando que Yahoo apruebe nuestro acceso.' },
    },
    pricing: {
      h2: 'Todas las ligas son gratis. Mejora tu plan para tener ventaja.',
      body: prices
        ? `Crea, importa y dirige todas las ligas que quieras, gratis. Los planes de pago desde ${prices.min}/mes agregan más Chimmy, análisis más profundo de cambios y jugadores, y automatización de comisionado.`
        : 'Crea, importa y dirige todas las ligas que quieras, gratis. Los planes de pago agregan más Chimmy, análisis más profundo de cambios y jugadores, y automatización de comisionado.',
      ctaPrimary: 'Regístrate gratis',
      ctaSecondary: 'Comparar planes',
    },
    faq: {
      h2: 'Lo que preguntan los managers',
      items: [
        {
          q: '¿Qué ligas puedo traer?',
          a: `${platforms} — en modo solo lectura, y en Sleeper basta con tu usuario. Copiamos tus rosters, enfrentamientos y reglas de puntuación reales, y nunca cambiamos nada en la plataforma original. También puedes crear una liga nueva aquí, gratis.`,
        },
        {
          q: '¿Cómo funciona la búsqueda de jugadores el día de juego?',
          a: 'Busca a un jugador una vez y mira en qué ligas lo tienes, su lugar en el roster y su estado de lesión, cuánto falta para el cierre del lineup, y el cambio que corresponde en cada una.',
        },
        {
          q: '¿AllFantasy es apuestas o DFS?',
          a: 'No. AllFantasy es 100% fantasy de temporada completa. Sin casa de apuestas, sin fantasy diario.',
        },
        {
          q: '¿Cuánto cuesta?',
          a: prices
            ? `Crear, importar y dirigir ligas es gratis para siempre. Los planes de pago van de ${prices.min} a ${prices.max} al mes y se cancelan cuando quieras.`
            : 'Crear, importar y dirigir ligas es gratis para siempre. Cualquier plan de pago se cancela cuando quieras.',
          aboutPrice: true,
        },
      ],
    },
    network: {
      label: 'Más de Brown Pig LLC',
      cards: [
        { name: 'Gooby', body: 'Descubrimiento social para la gente y sus perros.' },
        { name: 'Cafe Con Chimmy', body: 'Cultura, café y conversación del mundo de Chimmy.' },
        { name: 'Parent Playbook', body: 'Jugadas prácticas para mamás y papás, una situación a la vez.' },
        {
          name: 'PetPass',
          body: 'Cada registro, visita al veterinario y recordatorio de tu mascota en un solo lugar.',
        },
        { name: 'SideQuest', body: 'Convierte ese proyecto extra en una misión medible y terminable.' },
        { name: 'StoryVault', body: 'Graba y guarda las historias de tu familia antes de que se pierdan.' },
      ],
    },
    footer: {
      playerFinder: 'Buscador de jugadores',
      dashboard: 'Panel',
      privacy: 'Privacidad',
      terms: 'Términos',
      dataDeletion: 'Eliminación de datos',
      privacyChoices: 'No vender ni compartir mi información personal',
      builtByLabel: 'Hecho por',
      compliance:
        'No disponible en WA. Ligas de pago restringidas en HI, ID, MT y NV. 100% fantasy de temporada — sin apuestas, sin DFS.',
    },
  }
}

const LANDING_COPY: Record<LandingLang, (prices: MonthlyPriceRange | null) => LandingCopy> = {
  en: EN,
  es: ES,
}

/**
 * ⚠ `prices` IS REQUIRED, AND THAT IS THE POINT. It used to be absent and the two
 * strings that quote money were typed out — "paid plans run $9.99–$29.99/mo", in
 * both languages, long after $29.99 stopped being any plan's price. Making the
 * range an argument means the copy cannot be rendered without someone handing it
 * the live catalog, so the next price change reaches this page for free.
 *
 * Pass `null` only where no plan is sold monthly; the copy then omits the figures
 * rather than printing a placeholder.
 */
export function getLandingCopy(
  lang: LandingLang,
  prices: MonthlyPriceRange | null
): LandingCopy {
  return (LANDING_COPY[lang] ?? EN)(prices)
}
