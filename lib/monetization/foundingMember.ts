/**
 * Founding-member pricing — who gets it, and whether it is switched on. Pure: no server imports,
 * so pages, the checkout builder and tests all read the same rule.
 *
 * The rule (owner's decision, 2026-09-25): an account created BEFORE the paywall starts
 * (`getPaywallStartsAt`, lib/monetization/paywallLaunch.ts) is a founding member. When a founding
 * member checks out a SUBSCRIPTION, the Stripe Checkout session carries the coupon named by
 * `STRIPE_FOUNDING_COUPON_ID`. Token packs never get it.
 *
 * ⚠ THE DISCOUNT LIVES IN STRIPE, NOT HERE. The coupon's percentage and duration are whatever the
 * owner created in the Stripe dashboard, so no figure is written in this repo. Copy says "applied at
 * checkout", or quotes `FOUNDING_OFFER_LABEL` verbatim when the owner sets one ("50% off AF Pro for
 * life") — a number typed here would be one more place for the page and the charge to disagree.
 *
 * ⚠ UNSET MEANS OFF, EVERYWHERE. With `STRIPE_FOUNDING_COUPON_ID` unset, checkout behaves exactly as
 * it did before this file existed (promo codes allowed, no discount) and no page mentions founding
 * pricing — a page must never promise a discount checkout will not apply.
 */
import { getPaywallStartsAt, isPaywallLive } from '@/lib/monetization/paywallLaunch'

type Env = Record<string, string | undefined>

/** Longest `FOUNDING_OFFER_LABEL` we render; a runaway env value must not break a layout. */
const MAX_OFFER_LABEL_LENGTH = 80

/** The Stripe coupon id to apply, or null when founding pricing is switched off. */
export function getFoundingCouponId(env: Env = process.env): string | null {
  const raw = env.STRIPE_FOUNDING_COUPON_ID?.trim()
  return raw ? raw : null
}

/** The owner's display string for the offer (e.g. "50% off AF Pro for life"), or null. */
export function getFoundingOfferLabel(env: Env = process.env): string | null {
  const raw = env.FOUNDING_OFFER_LABEL?.replace(/\s+/g, ' ').trim()
  if (!raw) return null
  return raw.length > MAX_OFFER_LABEL_LENGTH ? `${raw.slice(0, MAX_OFFER_LABEL_LENGTH - 1).trimEnd()}…` : raw
}

/**
 * True when the account was created strictly before the paywall started. A missing or unparseable
 * creation date is NOT a founding member: the discount is only ever applied on positive evidence.
 */
export function isFoundingMemberAccount(
  createdAt: Date | string | null | undefined,
  env: Env = process.env,
): boolean {
  if (createdAt == null) return false
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt)
  const t = created.getTime()
  if (Number.isNaN(t)) return false
  return t < getPaywallStartsAt(env).getTime()
}

/**
 * What a pricing surface may say about founding pricing to this viewer.
 *   member    — signed in, account predates launch: "your founding discount is applied at checkout"
 *   prospect  — signed out, before launch: "sign up now and lock in founding-member pricing"
 *   null      — say nothing (switched off, a post-launch account, a signed-out visitor after launch,
 *               or a signed-in viewer whose creation date could not be read)
 */
export type FoundingOfferView = {
  audience: 'member' | 'prospect'
  /** `FOUNDING_OFFER_LABEL`, when the owner set one. Never a figure invented here. */
  label: string | null
}

export function resolveFoundingOfferView(args: {
  signedIn: boolean
  /** The viewer's `AppUser.createdAt`; ignored when signed out. */
  accountCreatedAt?: Date | string | null
  now?: Date
  env?: Env
}): FoundingOfferView | null {
  const env = args.env ?? process.env
  if (!getFoundingCouponId(env)) return null
  const label = getFoundingOfferLabel(env)
  if (args.signedIn) {
    return isFoundingMemberAccount(args.accountCreatedAt, env) ? { audience: 'member', label } : null
  }
  return isPaywallLive(args.now ?? new Date(), env) ? null : { audience: 'prospect', label }
}

/**
 * The offer for a surface that only renders BEFORE launch (the landing banner, the /core home card).
 * Before launch every account that exists was created before launch, so a signed-in viewer is a
 * founding member by construction and no creation-date read is needed. ⚠ Do not call this after
 * launch — use `resolveFoundingOfferView` with the real creation date.
 */
export function foundingOfferBeforeLaunch(args: { signedIn: boolean; env?: Env }): FoundingOfferView | null {
  const env = args.env ?? process.env
  if (!getFoundingCouponId(env)) return null
  return { audience: args.signedIn ? 'member' : 'prospect', label: getFoundingOfferLabel(env) }
}

/**
 * Everything a launch surface (countdown, founding note) needs, as plain serialisable data — the
 * server decides it, a client component renders it. `prelaunch` is the server's reading at render
 * time; the countdown re-checks the clock itself, so a page left open past launch still hides it.
 */
export type LaunchOfferView = {
  /** ISO instant the paywall starts. */
  startsAt: string
  prelaunch: boolean
  founding: FoundingOfferView | null
}

export function buildLaunchOfferView(args: {
  founding: FoundingOfferView | null
  now?: Date
  env?: Env
}): LaunchOfferView {
  const env = args.env ?? process.env
  return {
    startsAt: getPaywallStartsAt(env).toISOString(),
    prelaunch: !isPaywallLive(args.now ?? new Date(), env),
    founding: args.founding,
  }
}
