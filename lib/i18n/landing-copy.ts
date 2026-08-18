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

type Reason = { n: string; title: [string, string]; body: string }
type Faq = { q: string; a: string }
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
    cardFootBefore: string
    cardFootAfter: string
  }
  connects: { label: string; soon: string; sports: string }
  reasons: { h2: string; items: Reason[] }
  pricing: { h2: string; body: string; ctaPrimary: string; ctaSecondary: string }
  faq: { h2: string; items: Faq[] }
  network: { label: string; h2: string; body: string; cards: NetworkCard[] }
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

const EN: LandingCopy = {
  htmlLang: 'en',
  ogLocale: 'en_US',
  meta: {
    title: 'AllFantasy.ai — Every League You Play. One Screen. | NFL, NBA, NHL, MLB & More',
    description:
      'Connect Sleeper, ESPN and Yahoo and see every fantasy league you play on one screen. Cross-league player finder, lineup and waiver alerts, trade grades. Season-long fantasy only — no gambling, no DFS.',
    ogTitle: 'AllFantasy.ai — Every League You Play. One Screen.',
    ogDescription:
      'Connect Sleeper, ESPN and Yahoo. See what needs you across every league, and exactly where to go and fix it.',
  },
  nav: {
    how: 'How it works',
    pricing: 'Pricing',
    forCommissioners: 'For commissioners',
    signIn: 'Sign in',
    partners: 'Partners',
    getStarted: 'Get started free',
    langLabel: 'Language',
  },
  hero: {
    eyebrow: 'Fantasy sports only · no gambling',
    h1a: 'Every league you play.',
    h1b: 'One screen.',
    sub: 'Connect Sleeper, ESPN and Yahoo. See what needs you across every league, and exactly where to go and fix it.',
    ctaPrimary: 'Get started free',
    ctaSecondary: 'See how it works',
    reassure: 'Free forever for players · Read-only · Cancel anytime',
    cardTitle: 'Your leagues',
    cardWeek: 'Week 12 · example',
    cardFootBefore: 'Two fixes worth ',
    cardFootAfter: ' — Chimmy, across all 4 leagues',
  },
  connects: {
    label: 'Connects to',
    soon: 'soon',
    sports: 'NFL · NBA · NHL · MLB · NCAA · SOCCER',
  },
  reasons: {
    h2: 'Three things you can’t do anywhere else',
    items: [
      {
        n: '01',
        title: ['All your leagues,', 'one board.'],
        body: 'Sleeper, ESPN and Yahoo, with your real rosters and history. One Sunday view instead of four tabs.',
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
    h2: 'Free to see it all. Upgrade to act on it.',
    body: 'Every league, live score and standing is free. Paid plans from $9.99/mo add trade grades, projections and commissioner tools.',
    ctaPrimary: 'Start free',
    ctaSecondary: 'Compare plans',
  },
  faq: {
    h2: 'Questions managers ask',
    items: [
      {
        q: 'Can I import my Sleeper, ESPN and Yahoo leagues?',
        a: 'Yes — read-only. We copy your real rosters, matchups and scoring, and never change anything on the platform.',
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
        a: 'Free forever for players. Paid plans run $9.99–$29.99/mo and can be cancelled anytime.',
      },
    ],
  },
  network: {
    label: 'From Brown Pig LLC',
    h2: 'Apps that solve real problems',
    body: 'AllFantasy is one of six products we build and run. One account family, same standard.',
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
const ES: LandingCopy = {
  htmlLang: 'es',
  ogLocale: 'es_US',
  meta: {
    title: 'AllFantasy.ai — Todas tus ligas. Una sola pantalla. | NFL, NBA, NHL, MLB y más',
    description:
      'Conecta Sleeper, ESPN y Yahoo y mira todas tus ligas de fantasy en una sola pantalla. Buscador de jugadores entre ligas, alertas de lineup y waivers, calificación de cambios. Solo fantasy de temporada — sin apuestas, sin DFS.',
    ogTitle: 'AllFantasy.ai — Todas tus ligas. Una sola pantalla.',
    ogDescription:
      'Conecta Sleeper, ESPN y Yahoo. Mira qué necesita tu atención en cada liga, y exactamente dónde entrar a resolverlo.',
  },
  nav: {
    how: 'Cómo funciona',
    pricing: 'Precios',
    forCommissioners: 'Para comisionados',
    signIn: 'Iniciar sesión',
    partners: 'Socios',
    getStarted: 'Empieza gratis',
    langLabel: 'Idioma',
  },
  hero: {
    eyebrow: 'Solo fantasy · sin apuestas',
    h1a: 'Todas tus ligas.',
    h1b: 'Una sola pantalla.',
    sub: 'Conecta Sleeper, ESPN y Yahoo. Mira qué necesita tu atención en cada liga, y exactamente dónde entrar a resolverlo.',
    ctaPrimary: 'Empieza gratis',
    ctaSecondary: 'Mira cómo funciona',
    reassure: 'Gratis para siempre · Solo lectura · Cancela cuando quieras',
    cardTitle: 'Tus ligas',
    cardWeek: 'Semana 12 · ejemplo',
    cardFootBefore: 'Dos ajustes que valen ',
    cardFootAfter: ' — Chimmy, en las 4 ligas',
  },
  connects: {
    label: 'Se conecta con',
    soon: 'pronto',
    sports: 'NFL · NBA · NHL · MLB · NCAA · FÚTBOL',
  },
  reasons: {
    h2: 'Tres cosas que no puedes hacer en ningún otro lado',
    items: [
      {
        n: '01',
        title: ['Todas tus ligas,', 'un solo tablero.'],
        body: 'Sleeper, ESPN y Yahoo, con tus rosters y tu historial reales. Una sola vista el domingo en vez de cuatro pestañas.',
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
    h2: 'Gratis para verlo todo. Mejora tu plan para actuar.',
    body: 'Todas tus ligas, marcadores en vivo y posiciones son gratis. Los planes de pago desde $9.99/mes agregan calificación de cambios, proyecciones y herramientas de comisionado.',
    ctaPrimary: 'Empieza gratis',
    ctaSecondary: 'Comparar planes',
  },
  faq: {
    h2: 'Lo que preguntan los managers',
    items: [
      {
        q: '¿Puedo importar mis ligas de Sleeper, ESPN y Yahoo?',
        a: 'Sí — en modo solo lectura. Copiamos tus rosters, enfrentamientos y reglas de puntuación reales, y nunca cambiamos nada en la plataforma original.',
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
        a: 'Gratis para siempre para jugadores. Los planes de pago van de $9.99 a $29.99 al mes y se cancelan cuando quieras.',
      },
    ],
  },
  network: {
    label: 'De Brown Pig LLC',
    h2: 'Apps que resuelven problemas reales',
    body: 'AllFantasy es uno de seis productos que construimos y operamos. Una sola familia de cuentas, el mismo estándar.',
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

export const LANDING_COPY: Record<LandingLang, LandingCopy> = { en: EN, es: ES }

export function getLandingCopy(lang: LandingLang): LandingCopy {
  return LANDING_COPY[lang] ?? EN
}
