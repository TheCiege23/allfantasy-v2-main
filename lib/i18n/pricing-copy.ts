import type { PlanFamilyKey } from '@/lib/monetization/planIncludes'

/**
 * Pricing-page copy, in English and Spanish.
 *
 * ⚠ SAME RULE AS THE LANDING: PATHS, NEVER `?lang=`. Next 14.2 strips the search
 * string when resolving `alternates` against `metadataBase`, so a query-param
 * language cannot state a correct canonical — see the header comment in
 * components/landing/landing-route.tsx for the measurements that established it.
 *
 * ⚠ NO PRICE, TOKEN COUNT OR PLAN NAME APPEARS IN THIS FILE, IN EITHER LANGUAGE.
 * Every figure on /pricing is derived from the monetization catalog at render
 * time, and app/pricing/page.tsx and PricingV4 both carry long comments about why:
 * the token grants were wrong in three separate files, each of which had
 * transcribed a number instead of deriving it. A translation file is the easiest
 * possible fourth place for that to happen — a Spanish card quoting $29.99 would
 * be wrong in a language nobody on the team reads back. So the strings here are
 * chrome and prose only, and the numbers are interpolated by the component.
 */

export const PRICING_LANGS = ['en', 'es'] as const
export type PricingLang = (typeof PRICING_LANGS)[number]

export const DEFAULT_PRICING_LANG: PricingLang = 'en'

/** Where each language of the pricing page lives. See LANDING_PATHS for the rule. */
export const PRICING_PATHS: Record<PricingLang, string> = {
  en: '/pricing',
  es: '/es/pricing',
}

export type PricingFaq = { q: string; a: string }

export type PricingCopy = {
  htmlLang: string
  ogLocale: string
  meta: { title: string; description: string; ogTitle: string; ogDescription: string }
  nav: { wordmark: string; signIn: string; startFree: string }
  hero: { eyebrow: string; title: string; sub: string }
  toggle: { label: string; monthly: string; yearly: string }
  free: { name: string; desc: string; per: string; cta: string; includes: string[] }
  card: {
    bestValue: string
    picked: string
    perMonth: string
    perYear: string
    notSoldMonthly: string
    notSoldYearly: string
    /** e.g. "Choose AF Pro" — the plan name is a brand and is not translated. */
    choose: (planName: string) => string
    opening: string
    /** e.g. "$8.33/mo · save $20 (17%)" — figures come from the catalog. */
    saveLine: (effectiveMonthly: string, saved: string, pct: number) => string
    /** Chip beside the interval toggle, e.g. "Save 28% paying yearly". */
    savingsChip: (pct: number) => string
  }
  yearly: {
    h2: string
    sub: string
    /** e.g. "$6.67/mo · save 33%" on the annual summary cards. */
    line: (effectiveMonthly: string, pct: number) => string
  }
  blocked: string
  tokens: { h2: string; sub: string; tokensLabel: string; buy: string; buying: string }
  faq: { h2: string; items: PricingFaq[] }
  foot: {
    stripe: string
    terms: string
    privacy: string
    noGambling: string
    cta: string
    langLabel: string
  }
  /**
   * Plan descriptions and feature bullets.
   *
   * ⚠ `null` ON ENGLISH IS LOAD-BEARING, NOT AN OMISSION. English already has one
   * source for these — the catalog's `description` and PLAN_FAMILY_INCLUDES — and
   * copying them here would create a second English copy to drift out of sync,
   * which is the exact failure this whole file is written to avoid. `null` means
   * "read the existing source"; only Spanish, which has no other source, carries
   * strings.
   */
  planDescriptions: Record<PlanFamilyKey, string> | null
  planIncludes: Record<PlanFamilyKey, readonly string[]> | null
}

const EN: PricingCopy = {
  htmlLang: 'en',
  ogLocale: 'en_US',
  meta: {
    title: 'Pricing & Plans — AllFantasy.ai | Fantasy Tools & Subscriptions',
    description:
      'Compare AF Pro, AF Legacy, AF Commissioner and AF Supreme. Tokens for pay-per-use. Secure Stripe checkout. League dues and payouts are handled on FanCred.',
    ogTitle: 'AllFantasy Pricing — Unlock fantasy tools for your league',
    ogDescription:
      'Subscribe for full access, or buy tokens and pay only for what you use. Clear plans, Stripe checkout.',
  },
  nav: { wordmark: 'Pricing', signIn: 'Sign in', startFree: 'Start free' },
  hero: {
    eyebrow: 'Pricing',
    title: 'Win more with tools built for fantasy managers',
    sub: 'Every league, live score and standing is free forever. Subscribe for Chimmy intelligence and commissioner tools — or buy tokens when you need them.',
  },
  toggle: { label: 'Billing interval', monthly: 'Monthly', yearly: 'Yearly' },
  free: {
    name: 'Free',
    desc: 'Every league you play, in one place. No card, no trial clock.',
    per: 'free forever',
    cta: 'Create an account',
    includes: [
      'Every league you play, in one place',
      'Live scores and standings',
      'Import from Sleeper, ESPN and Yahoo',
    ],
  },
  card: {
    bestValue: 'Best value',
    picked: 'Your pick',
    perMonth: 'per month',
    perYear: 'per year',
    notSoldMonthly: 'not sold monthly',
    notSoldYearly: 'not sold yearly',
    choose: (planName) => `Choose ${planName}`,
    opening: 'Opening checkout…',
    saveLine: (effectiveMonthly, saved, pct) => `${effectiveMonthly}/mo · save ${saved} (${pct}%)`,
    savingsChip: (pct) => `Save ${pct}% paying yearly`,
  },
  yearly: {
    h2: 'Yearly, if you’d rather pay once',
    sub: 'The same plans billed annually. Every figure below is what the card is charged.',
    line: (effectiveMonthly, pct) => `${effectiveMonthly}/mo · save ${pct}%`,
  },
  blocked: 'Paid plans are not available in your state. Everything free stays available.',
  tokens: {
    h2: 'Or pay only for what you use',
    sub: 'Tokens are for managers who do not want a subscription. Every action shows its cost before you click, and what you buy never expires into a monthly reset.',
    tokensLabel: 'tokens',
    buy: 'Buy',
    buying: 'Opening…',
  },
  faq: {
    h2: 'Before you decide',
    items: [
      {
        q: 'What stays free?',
        a: "Every league, live score and standing. Imports are unlimited and there's no trial clock on them.",
      },
      {
        q: 'Do you take league dues?',
        a: "No. League dues and payouts are handled on FanCred — AllFantasy never holds your league's money.",
      },
      {
        q: 'Can I cancel?',
        a: 'Any time, from Settings → Billing. Purchases follow the pricing shown at checkout and the applicable refund policy.',
      },
      {
        q: 'Is this gambling?',
        a: 'No. 100% season-long fantasy — no sportsbook, no daily fantasy. Not available in WA; paid leagues restricted in HI, ID, MT, NV.',
      },
    ],
  },
  foot: {
    stripe:
      'Checkout is handled by Stripe — we never see your card details. League dues and payouts are handled on FanCred, separately from your AllFantasy subscription.',
    terms: 'Terms',
    privacy: 'Privacy',
    noGambling: 'No-gambling policy',
    cta: 'Start free',
    langLabel: 'Language',
  },
  planDescriptions: null,
  planIncludes: null,
}

/*
 * ⚠ WRITTEN, NOT CALQUED — same rule the landing copy follows. Fantasy vocabulary
 * in US Spanish keeps the English terms in daily use ("waivers", "draft",
 * "roster", "lineup"), and translating them reads as machine output to exactly
 * the audience this page is for. Product nouns (AllFantasy, Chimmy, Commissioner
 * OS, FanCred, Stripe) are names and stay, as do the plan names themselves.
 *
 * ⚠ THE COMPLIANCE AND MONEY ANSWERS CARRY THE SAME FACTS AS THE ENGLISH. The WA
 * block, the HI/ID/MT/NV restriction, "no gambling, no DFS", and "we never hold
 * your league's money" are legal statements enforced by useGeoRestriction and by
 * how the product actually works. Softening any of them in translation would
 * promise Spanish readers something different from what English readers are told.
 */
const ES: PricingCopy = {
  htmlLang: 'es',
  ogLocale: 'es_US',
  meta: {
    title: 'Precios y planes — AllFantasy.ai | Herramientas de fantasy y suscripciones',
    description:
      'Compara AF Pro, AF Legacy, AF Commissioner y AF Supreme. Tokens para pagar solo por lo que usas. Pago seguro con Stripe. Las cuotas y los pagos de tu liga se manejan en FanCred.',
    ogTitle: 'Precios de AllFantasy — Herramientas para tu liga de fantasy',
    ogDescription:
      'Suscríbete para tener acceso completo, o compra tokens y paga solo por lo que uses. Planes claros, pago con Stripe.',
  },
  nav: { wordmark: 'Precios', signIn: 'Iniciar sesión', startFree: 'Empieza gratis' },
  hero: {
    eyebrow: 'Precios',
    title: 'Gana más con herramientas hechas para managers de fantasy',
    sub: 'Todas tus ligas, marcadores en vivo y posiciones son gratis para siempre. Suscríbete para la inteligencia de Chimmy y las herramientas de comisionado — o compra tokens cuando los necesites.',
  },
  toggle: { label: 'Periodo de facturación', monthly: 'Mensual', yearly: 'Anual' },
  free: {
    name: 'Gratis',
    desc: 'Todas tus ligas en un solo lugar. Sin tarjeta, sin reloj de prueba.',
    per: 'gratis para siempre',
    cta: 'Crear una cuenta',
    includes: [
      'Todas las ligas que juegas, en un solo lugar',
      'Marcadores y posiciones en vivo',
      'Importa desde Sleeper, ESPN y Yahoo',
    ],
  },
  card: {
    bestValue: 'Mejor valor',
    picked: 'Tu elección',
    perMonth: 'al mes',
    perYear: 'al año',
    notSoldMonthly: 'no se vende mensual',
    notSoldYearly: 'no se vende anual',
    choose: (planName) => `Elegir ${planName}`,
    opening: 'Abriendo el pago…',
    saveLine: (effectiveMonthly, saved, pct) =>
      `${effectiveMonthly}/mes · ahorras ${saved} (${pct}%)`,
    savingsChip: (pct) => `Ahorra ${pct}% pagando al año`,
  },
  yearly: {
    h2: 'Anual, si prefieres pagar una sola vez',
    sub: 'Los mismos planes facturados al año. Cada cifra de abajo es lo que se cobra a la tarjeta.',
    line: (effectiveMonthly, pct) => `${effectiveMonthly}/mes · ahorras ${pct}%`,
  },
  blocked: 'Los planes de pago no están disponibles en tu estado. Todo lo gratis sigue disponible.',
  tokens: {
    h2: 'O paga solo por lo que uses',
    sub: 'Los tokens son para managers que no quieren una suscripción. Cada acción muestra su costo antes de que hagas clic, y lo que compras nunca vence ni se reinicia cada mes.',
    tokensLabel: 'tokens',
    buy: 'Comprar',
    buying: 'Abriendo…',
  },
  faq: {
    h2: 'Antes de decidir',
    items: [
      {
        q: '¿Qué queda gratis?',
        a: 'Todas tus ligas, marcadores en vivo y posiciones. Las importaciones son ilimitadas y no tienen reloj de prueba.',
      },
      {
        q: '¿Cobran las cuotas de la liga?',
        a: 'No. Las cuotas y los pagos se manejan en FanCred — AllFantasy nunca retiene el dinero de tu liga.',
      },
      {
        q: '¿Puedo cancelar?',
        a: 'Cuando quieras, desde Ajustes → Facturación. Las compras siguen el precio mostrado al pagar y la política de reembolso aplicable.',
      },
      {
        q: '¿Esto es apuestas?',
        a: 'No. 100% fantasy de temporada completa — sin casa de apuestas, sin fantasy diario. No disponible en WA; ligas de pago restringidas en HI, ID, MT y NV.',
      },
    ],
  },
  foot: {
    stripe:
      'El pago lo maneja Stripe — nunca vemos los datos de tu tarjeta. Las cuotas y los pagos de la liga se manejan en FanCred, aparte de tu suscripción de AllFantasy.',
    terms: 'Términos',
    privacy: 'Privacidad',
    noGambling: 'Política de no apuestas',
    cta: 'Empieza gratis',
    langLabel: 'Idioma',
  },
  planDescriptions: {
    af_pro:
      'Herramientas para managers activos — cambios, waivers, lineups y drafts.',
    af_commissioner:
      'Las herramientas para dirigir tus ligas — salud, integridad, resúmenes y el Commissioner OS.',
    af_war_room: 'El draft room en vivo, herramientas de dynasty y acceso prioritario.',
    af_supreme: 'AF Pro y AF Commissioner en un solo plan, por menos que comprar ambos.',
  },
  planIncludes: {
    af_pro: [
      'Chimmy avanzado, calificación de brackets y análisis de matchups',
      'Dark horse, upset finder, confianza y comparación de picks',
      'Decisiones de lineup del día de juego, calificadas con las reglas de tu liga',
    ],
    af_commissioner: [
      'Scoring personalizado, bloqueos, invitaciones, exportaciones y analíticas',
      'Resúmenes de comisionado, recaps y explicaciones del leaderboard',
      'Salud de la liga, revisiones de integridad y el Commissioner OS',
    ],
    af_war_room: [
      'Inteligencia en vivo de torneos y del draft room',
      'Flujos de dynasty, keeper y planeación de varias temporadas',
      'Acceso prioritario a las nuevas herramientas de draft',
    ],
    af_supreme: [
      'Todo lo de AF Pro y AF Commissioner',
      'Más barato que las dos suscripciones por separado',
      'Ideal para comisionados que además dirigen sus propios equipos',
    ],
  },
}

const COPY: Record<PricingLang, PricingCopy> = { en: EN, es: ES }

export function getPricingCopy(lang: PricingLang): PricingCopy {
  return COPY[lang] ?? EN
}
