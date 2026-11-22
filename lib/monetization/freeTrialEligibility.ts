import 'server-only'

import { prisma } from '@/lib/prisma'
import { trialDaysForSku } from './freeTrial'

/**
 * Who gets the AF Pro free trial (`./freeTrial.ts`): an account with NO subscription row at all — any
 * status, any source (Stripe, Apple, Google Play). A row survives cancellation and expiry, so a
 * cancelled trial or a lapsed plan is never a second trial. One indexed count.
 *
 * ⚠ FAILS CLOSED. If the read errors, the answer is "not eligible": the buyer pays the normal price,
 * which is the safe mistake. The opposite mistake hands out a free week the account was not due.
 */
export async function hasNeverSubscribed(userId: string): Promise<boolean> {
  try {
    const n = await prisma.userSubscription.count({ where: { userId } })
    return n === 0
  } catch {
    return false
  }
}

/** The trial days this account gets on this SKU right now: 0 when not eligible or not a trial SKU. */
export async function trialDaysForCheckout(userId: string, sku: string, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const days = trialDaysForSku(sku, env)
  if (days <= 0) return 0
  return (await hasNeverSubscribed(userId)) ? days : 0
}
