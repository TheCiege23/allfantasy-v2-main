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
 */

import type { MonthlyPriceRange } from '@/lib/monetization/planPresentation'
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
const OTHER_PLATFORMS = LIVE_PLATFORMS.filter((p) => p !== 'Sleeper')

type Reason = { n: string; title: [string, string]; body: string }
type Step = { n: string; title: string; body: string }
/**
 * `aboutPrice`: the answer quotes plan prices, so LandingV4 keeps it out of the iOS app, which
 * sells nothing (App Store 3.1.1). The FAQPage structured data still carries it — crawlers are
 * not the app.
 */
type Faq = { q: string; a: string; aboutPrice?: true }
type NetworkCard = { name: string; body: string }

export type LandingCopy = {
  /** Value for the document's `lang` attribute and the OpenGraph locale. */
  htmlLang: string
  ogLocale: string
  meta: { title: string; description: string; ogTitle: string; ogDescription: string }
  nav: {
    how: string
    pricing: string
    forCommissioners: string
    signIn: string
    /** Primary CTA when the reader is already signed in. */
    goToDashboard: string
    partners: string
    getStarted: string
    langLabel: string
  }
  hero: {
    eyebrow: string
    h1a: string
    h1b: string
    sub: string
    ctaPrimary: string
    ctaSecondary: string
    reassure: string
    cardTitle: string
    cardWeek: string
    /** Precedes the example uplift figure, e.g. "Two fixes worth " + "+13.0". */
    cardFootBefore: string
    /** Second line under it — who produced the figure and over what. */
    cardFootMeta: string
  }
  /**
   * Two sport lists under two labels: what IMPORTS today (football) and what a league CREATED here
   * can run (all seven). One unlabelled list under "Connects to" read as an import claim.
   */
  connects: { label: string; soon: string; importLabel: string; createLabel: string; soccer: string }
  /** The "How it works" anchor target: what a new account actually does, in order. */
  steps: { h2: string; items: Step[] }
  chimmy: {
    label: string
    h2: string
    body: string
    /** The exchange is illustrative, and says so, like the hero card. */
    exampleLabel: string
    question: string
    answer: string
    free: string
  }
  reasons: { h2: string; items: Reason[] }
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
      title: 'AllFantasy.ai — Every League You Play. One Screen. | NFL, NBA, NHL, MLB & More',
      description: `Connect ${platforms} and see every fantasy league you play on one screen. Cross-league player finder, lineup and waiver alerts, trade grades. Season-long fantasy only — no gambling, no DFS.`,
      ogTitle: 'AllFantasy.ai — Every League You Play. One Screen.',
      ogDescription: `Connect ${platforms}. See what needs you across every league, and exactly where to go and fix it.`,
    },
    nav: {
      how: 'How it works',
      pricing: 'Pricing',
      forCommissioners: 'For commissioners',
      signIn: 'Sign in',
      goToDashboard: 'Go to dashboard',
      partners: 'Partners',
      getStarted: 'Get started free',
      langLabel: 'Language',
    },
    hero: {
      // What it IS first. "Fantasy sports only · no gambling" told a stranger what it was not.
      eyebrow: 'Season-long fantasy football · no gambling',
      h1a: 'Every league you play.',
      h1b: 'One screen.',
      sub: `Bring in your ${platforms} leagues. See what needs you across all of them, and exactly where to go and fix it.`,
      ctaPrimary: 'Get started free',
      ctaSecondary: 'See how it works',
      reassure: 'Free for every league · Read-only — we never change your league · Sleeper needs just your username',
      cardTitle: 'Your leagues',
      cardWeek: 'Week 12 · example',
      cardFootBefore: 'Two fixes worth ',
      cardFootMeta: 'Chimmy, across all 4 leagues',
    },
    connects: {
      label: 'Connects to',
      soon: 'soon',
      importLabel: 'Imports',
      createLabel: 'Create a league',
      soccer: 'SOCCER',
    },
    steps: {
      h2: 'Set up in three steps',
      items: [
        {
          n: '01',
          title: 'Create a free account',
          body: 'No card needed. Every league you bring in stays free.',
        },
        {
          n: '02',
          title: 'Connect your leagues',
          body: `Sleeper takes just your username — no password. ${joinList(OTHER_PLATFORMS, 'en')} connect from the same screen. It is all read-only: nothing changes on the platform.`,
        },
        {
          n: '03',
          title: 'See what needs you',
          body: 'Every league on one board, most urgent first: empty lineup slots, injured starters, waiver runs and trades on the clock.',
        },
      ],
    },
    chimmy: {
      label: 'Meet Chimmy',
      h2: 'One question. Every league.',
      body: 'Chimmy is the AllFantasy assistant. It reads the rosters you connect, so the answer is about your teams — not generic advice.',
      exampleLabel: 'Example',
      question: 'Who’s hurt across all my leagues?',
      answer:
        'Two starters need you. Your RB1 is Out in Dynasty Dragons and Gridiron Gang — your bench RB is the swap in both. Your WR in Waiver Warriors is Questionable and his game has not started, so you can still wait on him.',
      free: `Free accounts get ${FREE_CHIMMY_QUESTIONS_PER_DAY} Chimmy questions a day.`,
    },
    reasons: {
      h2: 'Three things you can’t do anywhere else',
      items: [
        {
          n: '01',
          title: ['All your leagues,', 'one board.'],
          body: 'Every platform you play on, with your real rosters and history. One Sunday view instead of a tab per app.',
        },
        {
          n: '02',
          title: ['One player,', 'every league.'],
          body: 'Search a name and see every team you have him on, his injury status, and the swap or waiver that follows in each one.',
        },
        {
          n: '03',
          title: ['Know what', 'needs you.'],
          body: 'Unset lineups, waiver runs, trades on the clock — each tagged with the league and the deadline it belongs to.',
        },
      ],
    },
    pricing: {
      // ⚠ NOT "Upgrade to act on it" and NOT "free for players": creating, importing and
      // RUNNING leagues is free for players and commissioners alike (the Oct 15 paywall rule),
      // so the paid line is the edge on top — never the league itself.
      h2: 'Every league is free. Upgrade for the edge.',
      body: prices
        ? `Create, import and run as many leagues as you want — drafts, trades, waivers and live scoring included, free. Paid plans from ${prices.min}/mo add Chimmy, deeper trade and player analysis, and commissioner automation.`
        : 'Create, import and run as many leagues as you want — drafts, trades, waivers and live scoring included, free. Paid plans add Chimmy, deeper trade and player analysis, and commissioner automation.',
      ctaPrimary: 'Start free',
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
          q: 'How does the cross-league player finder work?',
          a: 'Search a player once and see every league you roster him in, his slot and injury status, and what to do about him in each.',
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
      builtByLabel: 'Built by',
      compliance:
        'Not available in WA. Paid leagues restricted in HI, ID, MT, NV. 100% fantasy sports — no gambling, no DFS.',
    },
  }
}

/*
 * ⚠ THE SPANISH IS WRITTEN, NOT TRANSLATED WORD-FOR-WORD. Fantasy vocabulary in
 * US Spanish keeps the English terms in daily use — "waivers", "draft", "roster",
 * "lineup" — and calquing them ("renuncias", "alineación") reads as machine output
 * to exactly the audience this page is for. Product nouns (AllFantasy, Decision
 * OS, Chimmy, Sleeper/ESPN/Yahoo) are names and stay.
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
      title: 'AllFantasy.ai — Todas tus ligas. Una sola pantalla. | NFL, NBA, NHL, MLB y más',
      description: `Conecta ${platforms} y mira todas tus ligas de fantasy en una sola pantalla. Buscador de jugadores entre ligas, alertas de lineup y waivers, calificación de cambios. Solo fantasy de temporada — sin apuestas, sin DFS.`,
      ogTitle: 'AllFantasy.ai — Todas tus ligas. Una sola pantalla.',
      ogDescription: `Conecta ${platforms}. Mira qué necesita tu atención en cada liga, y exactamente dónde entrar a resolverlo.`,
    },
    nav: {
      how: 'Cómo funciona',
      pricing: 'Precios',
      forCommissioners: 'Para comisionados',
      signIn: 'Iniciar sesión',
      goToDashboard: 'Ir al panel',
      partners: 'Socios',
      getStarted: 'Empieza gratis',
      langLabel: 'Idioma',
    },
    hero: {
      eyebrow: 'Fantasy football de temporada · sin apuestas',
      h1a: 'Todas tus ligas.',
      h1b: 'Una sola pantalla.',
      sub: `Trae tus ligas de ${platforms}. Mira qué necesita tu atención en todas, y exactamente dónde entrar a resolverlo.`,
      ctaPrimary: 'Empieza gratis',
      ctaSecondary: 'Mira cómo funciona',
      reassure: 'Gratis para todas tus ligas · Solo lectura: nunca cambiamos tu liga · En Sleeper basta con tu usuario',
      cardTitle: 'Tus ligas',
      cardWeek: 'Semana 12 · ejemplo',
      cardFootBefore: 'Dos ajustes que valen ',
      cardFootMeta: 'Chimmy, en las 4 ligas',
    },
    connects: {
      label: 'Se conecta con',
      soon: 'pronto',
      importLabel: 'Importa',
      createLabel: 'Crea una liga',
      soccer: 'FÚTBOL',
    },
    steps: {
      h2: 'Listo en tres pasos',
      items: [
        {
          n: '01',
          title: 'Crea tu cuenta gratis',
          body: 'Sin tarjeta. Todas las ligas que traigas siguen siendo gratis.',
        },
        {
          n: '02',
          title: 'Conecta tus ligas',
          body: `En Sleeper basta con tu usuario — sin contraseña. ${joinList(OTHER_PLATFORMS, 'es')} se conectan desde la misma pantalla. Todo es de solo lectura: nada cambia en la plataforma.`,
        },
        {
          n: '03',
          title: 'Mira qué te necesita',
          body: 'Todas tus ligas en un solo tablero, lo más urgente primero: lugares vacíos en el lineup, titulares lesionados, waivers que corren y cambios contra reloj.',
        },
      ],
    },
    chimmy: {
      label: 'Conoce a Chimmy',
      h2: 'Una pregunta. Todas tus ligas.',
      body: 'Chimmy es el asistente de AllFantasy. Lee los rosters que conectas, así que la respuesta es sobre tus equipos — no un consejo genérico.',
      exampleLabel: 'Ejemplo',
      question: '¿Quién está lesionado en todas mis ligas?',
      answer:
        'Dos titulares te necesitan. Tu RB1 está Out en Dynasty Dragons y Gridiron Gang — tu RB de la banca es el cambio en las dos. Tu WR en Waiver Warriors está Questionable y su partido no ha empezado, así que todavía puedes esperar.',
      free: `Las cuentas gratis tienen ${FREE_CHIMMY_QUESTIONS_PER_DAY} preguntas a Chimmy al día.`,
    },
    reasons: {
      h2: 'Tres cosas que no puedes hacer en ningún otro lado',
      items: [
        {
          n: '01',
          title: ['Todas tus ligas,', 'un solo tablero.'],
          body: 'Cada plataforma donde juegas, con tus rosters y tu historial reales. Una sola vista el domingo en vez de una pestaña por app.',
        },
        {
          n: '02',
          title: ['Un jugador,', 'todas tus ligas.'],
          body: 'Busca un nombre y mira en qué equipos lo tienes, su estado de lesión, y el cambio o el waiver que corresponde en cada liga.',
        },
        {
          n: '03',
          title: ['Sabe qué', 'te necesita.'],
          body: 'Lineups sin poner, waivers que corren, cambios contra reloj — cada uno marcado con su liga y su fecha límite.',
        },
      ],
    },
    pricing: {
      h2: 'Todas las ligas son gratis. Mejora tu plan para tener ventaja.',
      body: prices
        ? `Crea, importa y dirige todas las ligas que quieras — drafts, cambios, waivers y marcadores en vivo incluidos, gratis. Los planes de pago desde ${prices.min}/mes agregan a Chimmy, análisis más profundo de cambios y jugadores, y automatización de comisionado.`
        : 'Crea, importa y dirige todas las ligas que quieras — drafts, cambios, waivers y marcadores en vivo incluidos, gratis. Los planes de pago agregan a Chimmy, análisis más profundo de cambios y jugadores, y automatización de comisionado.',
      ctaPrimary: 'Empieza gratis',
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
          q: '¿Cómo funciona el buscador de jugadores entre ligas?',
          a: 'Busca a un jugador una vez y mira en qué ligas lo tienes, su lugar en el roster y su estado de lesión, y qué hacer con él en cada una.',
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
