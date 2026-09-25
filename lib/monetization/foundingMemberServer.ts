/**
 * Server half of founding-member pricing (the rule lives in ./foundingMember.ts): the one database
 * read it needs — the account's creation date — and the per-viewer launch view the pricing pages
 * hand to their client components.
 */
import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  buildLaunchOfferView,
  getFoundingCouponId,
  isFoundingMemberAccount,
  resolveFoundingOfferView,
  type LaunchOfferView,
} from '@/lib/monetization/foundingMember'

type Env = Record<string, string | undefined>

/** `AppUser.createdAt`, or null when there is no such user or the read failed. */
export async function readAccountCreatedAt(userId: string): Promise<Date | null> {
  try {
    const row = await prisma.appUser.findUnique({ where: { id: userId }, select: { createdAt: true } })
    return row?.createdAt ?? null
  } catch (error) {
    // Fails closed: an unreadable account is not treated as a founding member.
    console.error(
      '[founding-member] account creation date lookup failed',
      error instanceof Error ? error.message : String(error),
    )
    return null
  }
}

/**
 * For checkout: true only when founding pricing is switched on AND the account predates the
 * paywall. With `STRIPE_FOUNDING_COUPON_ID` unset this returns false WITHOUT touching the database,
 * so checkout is byte-for-byte what it was before.
 */
export async function isFoundingMemberUser(userId: string, env: Env = process.env): Promise<boolean> {
  if (!getFoundingCouponId(env)) return false
  return isFoundingMemberAccount(await readAccountCreatedAt(userId), env)
}

/**
 * The launch view for whoever is looking at a pricing page. A signed-out visitor costs no database
 * read; a signed-in one costs one indexed primary-key read, and only while founding pricing is on.
 */
export async function resolveLaunchOfferForViewer(
  userId: string | null | undefined,
  opts: { now?: Date; env?: Env } = {},
): Promise<LaunchOfferView> {
  const env = opts.env ?? process.env
  const now = opts.now ?? new Date()
  const signedIn = typeof userId === 'string' && userId.trim() !== ''
  const accountCreatedAt = signedIn && getFoundingCouponId(env) ? await readAccountCreatedAt(userId) : null
  return buildLaunchOfferView({
    now,
    env,
    founding: resolveFoundingOfferView({ signedIn, accountCreatedAt, now, env }),
  })
}
