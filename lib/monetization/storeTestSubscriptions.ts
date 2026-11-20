/**
 * STORE TEST PURCHASES ARE NOT SUBSCRIBERS (2026-11-19).
 *
 * Apple App Review and anyone testing on a TestFlight / Xcode build buys through Apple's free
 * sandbox. The purchase still writes a real `user_subscriptions` row (source `apple`, status
 * `active`), because the app must unlock Pro for the tester exactly as it would for a customer.
 * `lib/monetization/applePurchases.ts` stamps `metadata.environment` with Apple's value:
 * `Production`, `Sandbox`, `Xcode` or `LocalTesting`.
 *
 * Measured on production 2026-11-19: of 4 subscription rows, 2 were Apple `Sandbox` rows owned by
 * the App Store `reviewer` account. The admin Money panel counted both as subscriptions and the
 * MRR estimate priced the active one as Pro revenue, though no money moved.
 *
 * Use these filters for anything that COUNTS subscribers or revenue. Do NOT use them for access
 * checks: a sandbox tester must keep the Pro access they bought.
 */

import { Prisma } from '@prisma/client'

export const STORE_TEST_ENVIRONMENTS = ['Sandbox', 'Xcode', 'LocalTesting'] as const

/** Prisma `where` fragment that leaves out store test purchases. Rows from other sources pass. */
export const EXCLUDE_STORE_TEST_SUBSCRIPTIONS: Prisma.UserSubscriptionWhereInput = {
  NOT: {
    source: 'apple',
    OR: STORE_TEST_ENVIRONMENTS.map((env) => ({ metadata: { path: ['environment'], equals: env } })),
  },
}

/** The same rule for raw SQL against "user_subscriptions". */
export const EXCLUDE_STORE_TEST_SUBSCRIPTIONS_SQL = Prisma.sql`NOT (
  "source" = 'apple' AND COALESCE("metadata"->>'environment', '') IN (${Prisma.join([...STORE_TEST_ENVIRONMENTS])})
)`
