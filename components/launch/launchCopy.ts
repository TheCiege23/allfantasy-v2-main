/**
 * Every customer-facing string on the launch surfaces, in one place so the banner, the pricing
 * strips, the /core card and the tests read the same words.
 *
 * ⚠ NO DISCOUNT FIGURE IS WRITTEN HERE. The founding discount is a Stripe coupon the owner creates;
 * its size lives there. Copy either says "applied at checkout" or quotes the owner's own
 * `FOUNDING_OFFER_LABEL` (lib/monetization/foundingMember.ts). A number typed into this file would
 * be one more place for the page and the charge to disagree.
 *
 * ⚠ FOUNDING COPY ONLY APPEARS WHEN THE COUPON IS CONFIGURED — callers pass `founding: null`
 * otherwise, and every string below has a founding-free variant. The page must never promise a
 * price the checkout will not apply.
 *
 * Brand voice: direct, warm, a little competitive. "Chimmy", never bare "AI".
 */
import type { FoundingOfferView } from '@/lib/monetization/foundingMember'
import { formatLaunchDay, type LaunchLang } from '@/components/launch/launchTime'

/** What AF Pro takes over on launch day — the three depths the /core paywall gates. */
const PRO_DEPTH_EN = 'player deep dives, the full trade breakdown and Competitive Edge'

/** "Free until Oct 15" — the countdown's lead and its server-rendered text. */
export function freeUntilLabel(startsAt: string, lang: LaunchLang = 'en'): string {
  const day = formatLaunchDay(startsAt, lang)
  return lang === 'es' ? `Gratis hasta el ${day}` : `Free until ${day}`
}

/** "left" / "restantes", after the spoken remaining time. */
export function remainingSuffix(lang: LaunchLang = 'en'): string {
  return lang === 'es' ? 'restantes' : 'left'
}

export type LandingBannerCopy = {
  kicker: string
  title: string
  body: string
  cta: { href: string; label: string }
}

/**
 * The landing banner. Signed-out visitors are asked to sign up; a signed-in visitor already has an
 * account, and before launch every account is a founding one, so they are told so instead.
 *
 * `FOUNDING_OFFER_LABEL` is English (the owner writes one string), so the Spanish page states the
 * offer without quoting it rather than dropping an English phrase into a Spanish sentence.
 */
export function landingBannerCopy(args: {
  startsAt: string
  lang: LaunchLang
  signedIn: boolean
  founding: FoundingOfferView | null
}): LandingBannerCopy {
  const { startsAt, lang, signedIn, founding } = args
  const day = formatLaunchDay(startsAt, lang)
  const label = lang === 'en' ? founding?.label ?? null : null

  if (lang === 'es') {
    return {
      kicker: 'Cuenta regresiva',
      title: `Todo es gratis hasta el ${day}.`,
      body: signedIn
        ? founding
          ? 'Ya eres miembro fundador: tu precio está asegurado.'
          : 'Todas las herramientas están abiertas hasta entonces. Aprovéchalas.'
        : founding
          ? 'Regístrate ahora y asegura el precio de miembro fundador.'
          : 'Regístrate mientras es gratis: todas las herramientas están abiertas hasta entonces y tus ligas siguen gratis después.',
      cta: signedIn
        ? founding
          ? { href: '/pricing', label: 'Ver precio de fundador' }
          : { href: '/core', label: 'Ir al panel' }
        : { href: '/signup', label: 'Regístrate gratis' },
    }
  }

  return {
    kicker: 'Launch countdown',
    title: `Everything's free until ${day}.`,
    body: signedIn
      ? founding
        ? `You're in as a founding member. Your pricing is locked in${label ? `: ${label}` : ''}.`
        : "Every tool is open until then. Make it count."
      : founding
        ? `Sign up now and lock in founding-member pricing${label ? `: ${label}` : ''}.`
        : "Sign up while it's free. Every tool is open until then, and your leagues stay free after.",
    cta: signedIn
      ? founding
        ? { href: '/pricing', label: 'See founding pricing' }
        : { href: '/core', label: 'Go to dashboard' }
      : { href: '/signup', label: 'Sign up free' },
  }
}

export type OfferStripSurface = 'pricing' | 'upgrade' | 'signup' | 'core'

export type OfferStripCopy = {
  /** Shown only before launch, beside the countdown. */
  title: string
  body: string | null
  /** The founding line — shown before AND after launch for a founding member. */
  founding: string | null
  foundingLink: { href: string; label: string } | null
  cta: { href: string; label: string } | null
}

/** The strip beside the plans on /pricing and /upgrade, the /signup bar and the /core home card. */
export function offerStripCopy(args: {
  startsAt: string
  surface: OfferStripSurface
  founding: FoundingOfferView | null
}): OfferStripCopy {
  const { startsAt, surface, founding } = args
  const day = formatLaunchDay(startsAt, 'en')
  const label = founding?.label ?? null

  let foundingLine: string | null = null
  let foundingLink: OfferStripCopy['foundingLink'] = null
  if (founding?.audience === 'member') {
    foundingLine = label
      ? `Founding member: ${label}, applied automatically at checkout.`
      : 'Founding member: your discount is applied automatically at checkout.'
    // /upgrade is the one surface with a promo-code box, and a code REPLACES the founding coupon
    // (Stripe takes one discount per checkout). Say so rather than let someone swap down.
    if (surface === 'upgrade') foundingLine += ' No code needed — a promo code would replace it.'
  } else if (founding?.audience === 'prospect') {
    foundingLine = `Sign up before ${day} and lock in founding-member pricing${label ? `: ${label}` : ''}.`
    if (surface !== 'signup') foundingLink = { href: '/signup', label: 'Create a free account' }
  }

  if (surface === 'signup') {
    return {
      title: `Everything's free until ${day}`,
      body: founding ? null : 'Every tool is open until then.',
      founding: foundingLine,
      foundingLink: null,
      cta: null,
    }
  }

  if (surface === 'core') {
    return {
      title: `Everything's free until ${day}`,
      body: `Then ${PRO_DEPTH_EN} move to AF Pro. Your leagues stay free.`,
      founding: foundingLine,
      foundingLink: null,
      cta: { href: '/upgrade?plan=pro', label: 'See AF Pro' },
    }
  }

  return {
    title: `Everything's free until ${day}`,
    body: `Your leagues stay free forever. On ${day}, ${PRO_DEPTH_EN} move to AF Pro.`,
    founding: foundingLine,
    foundingLink,
    cta: null,
  }
}
