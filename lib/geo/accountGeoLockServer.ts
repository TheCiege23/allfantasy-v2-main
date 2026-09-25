/**
 * The Node-side binding of `./accountGeoLock`: the Prisma store, and the one call
 * the NextAuth `jwt` callback makes. Kept apart from the logic so the logic is
 * testable without a database and so nothing edge-bound imports Prisma.
 *
 * Never imported by middleware.ts. The middleware reads the lock from the
 * session token, where the jwt callback put it.
 */

import { headers as requestHeaders } from "next/headers"

import { prisma } from "@/lib/prisma"

import {
  ACCOUNT_CARD_PAID_BLOCK,
  ACCOUNT_FULL_BLOCK,
  accountGeoLockFromLevel,
  forgetAccountGeoLock,
  observeAndReadAccountLock,
  type AccountGeoLock,
  type AccountLockStore,
} from "./accountGeoLock"
import { isFullyBlocked } from "./restrictedStates"

export const prismaAccountLockStore: AccountLockStore = {
  async read(userId) {
    try {
      const row = await prisma.appUser.findUnique({
        where: { id: userId },
        select: { stateRestrictionLevel: true },
      })
      // No row is an authoritative "no lock"; a failed read is `undefined`.
      return accountGeoLockFromLevel(row?.stateRestrictionLevel)
    } catch {
      return undefined
    }
  },
  async lock(userId, stateCode) {
    await prisma.appUser.update({
      where: { id: userId },
      data: { stateRestrictionLevel: ACCOUNT_FULL_BLOCK, isStateRestricted: true, detectedStateCode: stateCode },
    })
  },
}

/**
 * The current request's headers, or null outside a request.
 *
 * ⚠ Copied into a real `Headers`. `next/headers` returns a ReadonlyHeaders that
 * is not `instanceof Headers`, and the geo helpers branch on exactly that check
 * — handed the original, they would read `.headers` off it and throw.
 */
function currentRequestHeaders(): Headers | null {
  try {
    return new Headers([...requestHeaders().entries()])
  } catch {
    return null
  }
}

/** Observe this request for the account and return its lock (`undefined` = could not read). */
export async function refreshAccountGeoLock(userId: string): Promise<AccountGeoLock | undefined> {
  return observeAndReadAccountLock(userId, currentRequestHeaders(), prismaAccountLockStore)
}

/**
 * The account's lock read straight from the database, skipping the per-process
 * cache — for a checkout, where a stale "unlocked" would mint a Stripe session
 * the webhook then has to refund. `undefined` = the read failed.
 */
export async function readAccountGeoLockFresh(userId: string): Promise<AccountGeoLock | undefined> {
  return prismaAccountLockStore.read(userId)
}

/**
 * Lock the account because a purchase's card billing address was in a
 * restricted state. Leaves `detectedStateCode` alone either way: that column
 * records where the account was SEEN, and a card is not a sighting.
 *
 * A WASHINGTON card is the full lock (owner's decision, 2026-09-25): Washington
 * bans even free play, and a Washington billing address is as strong a sign of
 * where the buyer lives as a Washington sighting. Any other restricted state is
 * the card lock — paid surfaces only — and never downgrades a full lock.
 *
 * ⚠ The filter spells out the NULL case. `{ not: "full_block" }` alone is SQL
 * `<> 'full_block'`, which is NULL — not true — for an account with no level at
 * all, so it would silently skip exactly the accounts this exists to lock.
 */
export async function lockAccountForCardBillingState(userId: string, stateCode: string): Promise<void> {
  if (isFullyBlocked(stateCode)) {
    await prisma.appUser.updateMany({
      where: { id: userId },
      data: { stateRestrictionLevel: ACCOUNT_FULL_BLOCK, isStateRestricted: true },
    })
  } else {
    await prisma.appUser.updateMany({
      where: {
        id: userId,
        OR: [{ stateRestrictionLevel: null }, { stateRestrictionLevel: { not: ACCOUNT_FULL_BLOCK } }],
      },
      data: { stateRestrictionLevel: ACCOUNT_CARD_PAID_BLOCK, isStateRestricted: true },
    })
  }
  forgetAccountGeoLock(userId)
}
