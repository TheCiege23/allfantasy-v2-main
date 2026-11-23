/**
 * The server half of the no-account support checkout (lib/monetization/supportGuestCheckout):
 * who paid, the account made for them, and the two one-time ways in.
 *
 * TWO ONE-TIME SIGN-IN TOKENS, both in `auth_verification_tokens` (the NextAuth table no
 * provider here uses), both stored only as a sha256, both deleted on first use:
 *
 *   - CLAIM (`support-claim:<userId>`, 2 hours). Minted ONLY when this checkout CREATED the
 *     account. Its secret is the Checkout Session id, which only Stripe and the paying browser
 *     hold (it rides the success URL). It is what lets the thank-you page sign them in.
 *   - LINK (`support-link:<userId>`, 7 days). Emailed. Proves the inbox, so using it also
 *     marks the email verified. Opening the link does NOT spend it — the page asks for a tap,
 *     because mail scanners open links and would burn a single-use token before the person did.
 *
 * 🛑 AN EXISTING ACCOUNT NEVER GETS A CLAIM TOKEN. The email on Stripe's page is typed, not
 * proven; signing the paying browser into an account that already existed would let anyone
 * who knows your address into your account for $9.99.
 */
import "server-only"
import type Stripe from "stripe"

import { prisma } from "@/lib/prisma"
import { makeToken, sha256Hex } from "@/lib/tokens"
import { generateUniqueUsername } from "@/lib/signup/AutoUsernameGenerator"
import { ensureSharedAccountProfile } from "@/lib/auth/SharedAccountBootstrapService"
import {
  getMonetizationCatalogItemBySku,
  type MonetizationSku,
  type SubscriptionPlanFamily,
} from "@/lib/monetization/catalog"
import { resolveSubscriptionStatus } from "@/lib/subscription/SubscriptionStatusResolver"
import { duplicatePlanReason } from "@/lib/monetization/stripeCustomerForUser"
import { SUPPORT_GUEST_SKU, supportGuestAgeConfirmed } from "@/lib/monetization/supportGuestCheckout"

export const SUPPORT_CLAIM_TTL_MS = 2 * 60 * 60 * 1000
export const SUPPORT_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CLAIM_PREFIX = "support-claim:"
const LINK_PREFIX = "support-link:"

export type SupportGuestBuyer = {
  userId: string
  email: string
  username: string
  /** True only when THIS checkout made the account. */
  created: boolean
}

/** The email Stripe collected, trimmed and lowercased, or null. */
export function checkoutEmail(session: Pick<Stripe.Checkout.Session, "customer_details" | "customer_email">): string | null {
  const raw = session.customer_details?.email ?? session.customer_email ?? ""
  const email = raw.trim().toLowerCase()
  return email.includes("@") ? email : null
}

async function findUserByEmail(email: string) {
  return prisma.appUser.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true, username: true },
  })
}

/**
 * The account this checkout belongs to: the existing one for that email, or a new one made
 * now with an automatic username and no password. Idempotent — a retried webhook, or the
 * completed + async-succeeded pair, finds the account the first pass made.
 */
export async function resolveSupportGuestBuyer(session: Stripe.Checkout.Session): Promise<SupportGuestBuyer | null> {
  const email = checkoutEmail(session)
  if (!email) return null

  const existing = await findUserByEmail(email)
  if (existing) {
    // "created" must survive a retry: if THIS checkout made the account on an earlier pass, it
    // still counts as new (the claim token is what the thank-you page is waiting for).
    const madeByThisCheckout = await prisma.authVerificationToken.findFirst({
      where: { identifier: `${CLAIM_PREFIX}${existing.id}`, token: sha256Hex(session.id) },
      select: { token: true },
    })
    return { userId: existing.id, email, username: existing.username, created: Boolean(madeByThisCheckout) }
  }

  const name = session.customer_details?.name?.trim() || null
  const username = await generateUniqueUsername({
    name,
    isTaken: async (candidate) =>
      Boolean(
        await prisma.appUser.findFirst({
          where: { username: { equals: candidate, mode: "insensitive" } },
          select: { id: true },
        }),
      ),
  })
  // First name only on screen; the username is the fallback.
  const displayName = name ? name.split(/\s+/)[0]!.slice(0, 40) : username

  let user: { id: string; username: string }
  try {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.appUser.create({
        data: { email, username, displayName, passwordHash: null },
        select: { id: true, username: true },
      })
      // The claim token is written WITH the account, so "the account exists" and "this checkout
      // made it" can never disagree after a crash between the two.
      await tx.authVerificationToken.create({
        data: {
          identifier: `${CLAIM_PREFIX}${created.id}`,
          token: sha256Hex(session.id),
          expires: new Date(Date.now() + SUPPORT_CLAIM_TTL_MS),
        },
      })
      return created
    })
  } catch (error) {
    // A concurrent pass made it first (email is unique): use that one.
    if ((error as { code?: string })?.code === "P2002") {
      const again = await findUserByEmail(email)
      if (again) return resolveSupportGuestBuyer(session)
    }
    throw error
  }

  await ensureSharedAccountProfile({
    userId: user.id,
    displayName,
    ageConfirmed: supportGuestAgeConfirmed(session),
  })

  return { userId: user.id, email, username: user.username, created: true }
}

/**
 * Why this checkout would double-bill the account, or null. Reads the account's live Stripe
 * plans EXCEPT the one this very checkout created — on a webhook retry that row already exists,
 * and counting it would refund a legitimate first purchase.
 */
export async function supportGuestDuplicateReason(
  userId: string,
  session: Pick<Stripe.Checkout.Session, "id" | "subscription">,
): Promise<"same_plan" | "has_supreme" | null> {
  const item = getMonetizationCatalogItemBySku(SUPPORT_GUEST_SKU as MonetizationSku)
  if (!item?.planFamily) return null
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null
  const rows = await prisma.userSubscription.findMany({
    where: {
      userId,
      source: "stripe",
      NOT: [
        { stripeCheckoutSessionId: session.id },
        ...(subscriptionId ? [{ stripeSubscriptionId: subscriptionId }] : []),
      ],
    },
    select: { sku: true, status: true, currentPeriodEnd: true, gracePeriodEnd: true, expiresAt: true },
  })
  const families = new Set<SubscriptionPlanFamily>()
  for (const row of rows) {
    const status = resolveSubscriptionStatus(row)
    if (status !== "active" && status !== "grace" && status !== "past_due") continue
    const rowItem = row.sku ? getMonetizationCatalogItemBySku(row.sku as MonetizationSku) : null
    if (rowItem?.planFamily) families.add(rowItem.planFamily)
  }
  return duplicatePlanReason(families, item.planFamily)
}

/** Mint the emailed sign-in link's secret. Returns the RAW token; only its hash is stored. */
export async function createSupportSignInLinkToken(userId: string): Promise<string> {
  const raw = makeToken(32)
  await prisma.authVerificationToken.create({
    data: { identifier: `${LINK_PREFIX}${userId}`, token: sha256Hex(raw), expires: new Date(Date.now() + SUPPORT_LINK_TTL_MS) },
  })
  return raw
}

export type SupportCheckoutState = "pending" | "ready" | "check_email"

/**
 * What the thank-you page should do for this Checkout Session:
 *  - "ready": the account is new and its claim token is waiting — sign in now.
 *  - "check_email": the plan is recorded but there is nothing to claim (an existing account, or
 *    the claim was already used) — the sign-in link is in their inbox.
 *  - "pending": the webhook has not run yet.
 */
export async function supportCheckoutState(sessionId: string): Promise<SupportCheckoutState> {
  const claim = await prisma.authVerificationToken.findFirst({
    where: { token: sha256Hex(sessionId), identifier: { startsWith: CLAIM_PREFIX }, expires: { gt: new Date() } },
    select: { token: true },
  })
  if (claim) return "ready"
  const recorded = await prisma.userSubscription.findFirst({
    where: { stripeCheckoutSessionId: sessionId },
    select: { id: true },
  })
  return recorded ? "check_email" : "pending"
}

/**
 * The `support-link` credentials provider's authorize step. `kind` says which token this is;
 * a token of the other kind, an expired one, or a spent one all return null. The token is
 * deleted BEFORE the user is returned, so two racing requests cannot both get in.
 */
export async function authorizeSupportToken(rawKind: unknown, rawToken: unknown) {
  const kind = rawKind === "claim" ? "claim" : rawKind === "link" ? "link" : null
  const secret = String(rawToken ?? "").trim()
  if (!kind || secret.length < 16 || secret.length > 512) return null
  const prefix = kind === "claim" ? CLAIM_PREFIX : LINK_PREFIX
  const hash = sha256Hex(secret)

  const row = await prisma.authVerificationToken.findUnique({ where: { token: hash } })
  if (!row || !row.identifier.startsWith(prefix)) return null
  // Single use: whoever deletes the row is the one who gets in.
  const spent = await prisma.authVerificationToken.deleteMany({ where: { token: hash } })
  if (spent.count !== 1) return null
  if (row.expires.getTime() <= Date.now()) return null

  const userId = row.identifier.slice(prefix.length)
  const user = await prisma.appUser.findUnique({
    where: { id: userId },
    select: { id: true, email: true, emailVerified: true, displayName: true, username: true, avatarUrl: true },
  })
  if (!user) return null

  const { activeAccountRestriction, ACCOUNT_SUSPENDED_ERROR } = await import("@/lib/moderation/accountSuspension")
  if (await activeAccountRestriction(user.id)) throw new Error(ACCOUNT_SUSPENDED_ERROR)

  // The emailed link proves the inbox; the claim (a browser that paid) does not.
  if (kind === "link" && !user.emailVerified) {
    await prisma.appUser.update({ where: { id: user.id }, data: { emailVerified: new Date() } }).catch(() => undefined)
  }

  return {
    id: user.id,
    email: user.email,
    name: user.displayName || user.username,
    username: user.username,
    image: user.avatarUrl,
  }
}
