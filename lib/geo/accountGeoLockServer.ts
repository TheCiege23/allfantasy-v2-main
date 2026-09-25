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
  ACCOUNT_FULL_BLOCK,
  observeAndReadAccountLock,
  type AccountGeoLock,
  type AccountLockStore,
} from "./accountGeoLock"

export const prismaAccountLockStore: AccountLockStore = {
  async read(userId) {
    try {
      const row = await prisma.appUser.findUnique({
        where: { id: userId },
        select: { stateRestrictionLevel: true },
      })
      // No row is an authoritative "no lock"; a failed read is `undefined`.
      return row?.stateRestrictionLevel === ACCOUNT_FULL_BLOCK ? ACCOUNT_FULL_BLOCK : null
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
