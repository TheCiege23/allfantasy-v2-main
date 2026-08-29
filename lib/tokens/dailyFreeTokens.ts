import { prisma } from '@/lib/prisma'
import { TOKEN_ENTRY_TYPES } from '@/lib/tokens/constants'

/**
 * The free floor for Chimmy: two questions a day.
 *
 * `app/api/chat/chimmy/route.ts` imported this module and called
 * `grantDailyFreeTokens` — but the module was never written, so the import was
 * unresolvable and the free tier it describes has never once run. Measured against
 * production 2026-08-28: 32 of 34 users sit at a ZERO balance while a Chimmy message
 * costs 10, i.e. nearly every account could not ask a single question.
 */
export const FREE_CHIMMY_QUESTIONS_PER_DAY = 2

/** The rule the route actually spends against, so the floor tracks real pricing. */
const CHIMMY_SPEND_RULE_CODE = 'ai_chimmy_chat_message'

/** UTC, so the reset is not a moving target per user timezone. */
function todayKey(userId: string, now: Date): string {
  return `daily-free:${userId}:${now.toISOString().slice(0, 10)}`
}

export type DailyFreeGrant =
  | { granted: number; reason: 'granted' }
  | { granted: 0; reason: 'already_granted_today' | 'at_or_above_floor' | 'no_spend_rule' }

/**
 * Top the caller's balance UP TO the free floor, at most once per UTC day.
 *
 * ⚠ TOP UP TO A FLOOR, NEVER ADD. Adding the floor each time would let anyone farm an
 * unbounded balance; and the day guard below is what makes "two a day" a cap rather than
 * a refill — without it a user could spend their two questions, drop below the floor, be
 * topped up again, and repeat forever. That is a money bug, not a UX one.
 *
 * ⚠ THE LEDGER ROW IS THE LOCK. `TokenLedger.idempotencyKey` is UNIQUE, so two concurrent
 * requests cannot both grant: the second violates the constraint and its transaction rolls
 * back, leaving the balance correct. Checking-then-writing without that constraint would
 * be a race that pays out twice.
 *
 * The floor is derived from the spend rule rather than hardcoded, so re-pricing a Chimmy
 * message moves the free tier with it. If the rule is missing we grant NOTHING — inventing
 * a price here would be worse than leaving the floor unapplied.
 */
export async function grantDailyFreeTokens(userId: string, now: Date = new Date()): Promise<DailyFreeGrant> {
  const rule = await prisma.tokenSpendRule.findUnique({
    where: { code: CHIMMY_SPEND_RULE_CODE },
    select: { tokenCost: true },
  })
  if (!rule || rule.tokenCost <= 0) return { granted: 0, reason: 'no_spend_rule' }

  const floor = rule.tokenCost * FREE_CHIMMY_QUESTIONS_PER_DAY
  const idempotencyKey = todayKey(userId, now)

  try {
    return await prisma.$transaction(async (tx) => {
      // A free account has no balance row at all until something creates one.
      const balance = await tx.userTokenBalance.upsert({
        where: { userId },
        update: {},
        create: { userId, balance: 0 },
        select: { id: true, balance: true },
      })

      const already = await tx.tokenLedger.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      })
      if (already) return { granted: 0, reason: 'already_granted_today' } as const

      const delta = floor - balance.balance
      if (delta <= 0) {
        /*
         * Deliberately does NOT consume the day. A paying user above the floor has taken
         * nothing, so if they spend down later today they still get their one top-up —
         * still capped at one, because that grant writes the key.
         */
        return { granted: 0, reason: 'at_or_above_floor' } as const
      }

      await tx.userTokenBalance.update({
        where: { userId },
        data: { balance: { increment: delta } },
      })

      await tx.tokenLedger.create({
        data: {
          userId,
          userTokenBalanceId: balance.id,
          entryType: TOKEN_ENTRY_TYPES.ADJUSTMENT,
          tokenDelta: delta,
          balanceBefore: balance.balance,
          balanceAfter: balance.balance + delta,
          sourceType: 'daily_free_tokens',
          idempotencyKey,
          description: `Daily free floor: ${FREE_CHIMMY_QUESTIONS_PER_DAY} Chimmy questions`,
        },
      })

      return { granted: delta, reason: 'granted' } as const
    })
  } catch (err) {
    /*
     * The unique-key violation from a concurrent grant is the EXPECTED outcome of the race
     * this is designed around, not a fault: the other transaction granted, so the user has
     * their floor either way. Anything else is rethrown — the caller wraps this in
     * `.catch(() => null)` and a real failure must not be disguised as a quiet success.
     */
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
      return { granted: 0, reason: 'already_granted_today' }
    }
    throw err
  }
}
