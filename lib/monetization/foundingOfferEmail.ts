/**
 * The founding-member offer email (checklist §5, "Tell existing users", due Oct 8), as plain text
 * for `sendMarketingEmail`. Copy is docs/FOUNDING_OFFER_EMAIL_DRAFT.md, word for word in English,
 * with every claim traced to code there. Pure: scripts/send-founding-offer.ts renders it and tests
 * pin it.
 *
 * Two rules the draft sets, enforced here rather than left to whoever sends it:
 *   - "Your founding pricing doesn't expire" is printed ONLY when the coupon's duration is
 *     `forever`. The repo cannot know the duration — it lives in Stripe — so the sender reads the
 *     live coupon and passes `couponForever`.
 *   - Spanish never quotes `FOUNDING_OFFER_LABEL` (the owner writes it in English), the same rule
 *     the site follows (components/launch/launchCopy.ts: `lang === 'en' ? founding?.label : null`).
 */
import { PRO_DEPTH_EN, PRO_DEPTH_ES } from '@/components/launch/launchCopy'

export type FoundingOfferEmailInput = {
  lang: 'en' | 'es'
  /** `FOUNDING_OFFER_LABEL`, verbatim, or null. Ignored for Spanish. */
  label: string | null
  /** The live coupon's duration is `forever`. */
  couponForever: boolean
  /** Production origin, no trailing slash — links must not point at localhost. */
  baseUrl: string
}

export function buildFoundingOfferEmail(input: FoundingOfferEmailInput): { subject: string; bodyText: string } {
  return input.lang === 'es' ? spanish(input) : english(input)
}

function english({ label, couponForever, baseUrl }: FoundingOfferEmailInput) {
  const offer = label ? `${label}, applied automatically at checkout` : 'your founding discount is applied automatically at checkout'
  const keep = couponForever
    ? "Your founding pricing doesn't expire and it doesn't need claiming — it's attached to the account you already have."
    : "Your founding pricing doesn't need claiming — it's attached to the account you already have."
  return {
    subject: "You're a founding member — here's what that means on October 15",
    bodyText: [
      "You were here first. That's the whole offer.",
      `On October 15 AllFantasy starts charging for the deep end of the product. You already have an account, which means you signed up before launch — so you're a founding member, and ${offer}. No code to enter, nothing to claim.`,
      `Here's exactly what changes. Three things that are open to everyone right now become AF Pro: ${PRO_DEPTH_EN}. That's it — that's the list.`,
      [
        "And here's what doesn't change, because I'd rather tell you than let you find out:",
        '• Trade Center still gives you the verdict on any deal, free. Pro is the written why behind it.',
        "• Time zones stay free. That was never going to be a paid feature.",
        '• Chimmy still answers two questions a day on the house, same as today.',
        "• If you're already paying for something, nothing about it moves.",
      ].join('\n'),
      `You don't have to do anything. ${keep} When you want the deep end, it's there at your price.`,
      "One thing worth knowing: don't paste a promo code at checkout. A code replaces your founding discount instead of stacking with it, and yours is already the better deal.",
      `See what's in Pro: ${baseUrl}/pricing\nYour account: ${baseUrl}/settings`,
      '— Guap\nAllFantasy · Brown Pig LLC',
    ].join('\n\n'),
  }
}

function spanish({ couponForever, baseUrl }: FoundingOfferEmailInput) {
  const keep = couponForever
    ? 'Tu precio de fundador no vence y no hay que reclamarlo: está ligado a la cuenta que ya tienes.'
    : 'Tu precio de fundador no hay que reclamarlo: está ligado a la cuenta que ya tienes.'
  return {
    subject: 'Eres miembro fundador: esto es lo que significa el 15 de octubre',
    bodyText: [
      'Llegaste primero. Esa es toda la oferta.',
      'El 15 de octubre AllFantasy empieza a cobrar por lo más profundo del producto. Ya tienes una cuenta, lo que significa que te registraste antes del lanzamiento: eres miembro fundador y tu descuento de fundador se aplica automáticamente al pagar. Sin código que ingresar, nada que reclamar.',
      `Esto es exactamente lo que cambia. Tres cosas que hoy están abiertas para todos pasan a AF Pro: ${PRO_DEPTH_ES}. Eso es todo: esa es la lista.`,
      [
        'Y esto es lo que no cambia, porque prefiero decírtelo antes de que lo descubras:',
        '• Trade Center te sigue dando el veredicto de cualquier cambio, gratis. Pro es el porqué detallado detrás de él.',
        '• Las zonas horarias siguen siendo gratis. Nunca iban a ser de pago.',
        '• Chimmy sigue respondiendo dos preguntas al día sin costo, igual que hoy.',
        '• Si ya pagas por algo, nada de eso cambia.',
      ].join('\n'),
      `No tienes que hacer nada. ${keep} Cuando quieras lo más profundo, estará ahí a tu precio.`,
      'Algo que conviene saber: no pegues un código promocional al pagar. Un código reemplaza tu descuento de fundador en lugar de sumarse, y el tuyo ya es la mejor oferta.',
      `Mira lo que incluye Pro: ${baseUrl}/pricing\nTu cuenta: ${baseUrl}/settings`,
      '— Guap\nAllFantasy · Brown Pig LLC',
    ].join('\n\n'),
  }
}
