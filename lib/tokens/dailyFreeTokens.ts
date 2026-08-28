import 'server-only'

import { prisma } from '@/lib/prisma'
import { TOKEN_ENTRY_TYPES } from '@/lib/tokens/constants'

/**
 * A DAILY FLOOR OF FREE TOKENS, SO A SIGNED-IN USER IS NEVER AT ZERO.
 *
 * ⚠ FREE USERS PREVIOUSLY GOT NOTHING AT ALL. `ai_chimmy_chat_message` costs 10
 * tokens, a new account's balance is `tokens?.balance ?? 0`, and no code path
 * ever granted a starting amount — so the first question anyone asked failed on
 * insufficient balance. The product intent was two free questions a day; the
 * implementation was zero, and nothing reported the gap because "insufficient
 * balance" is a plausible-looking answer.
 *
 * ⚠ IT IS A FLOOR, NOT AN ALLOWANCE THAT ACCUMULATES. Topping up TO the floor
 * rather than adding to it is what makes "two a day" true. Adding 20 every day
 * would let someone bank a fortnight of questions by not asking any, which is a
 * different product.
 *
 * ⚠ AND IT NEVER TOUCHES SOMEBODY WHO PAID. A user above the floor — anyone who
 * bought tokens or holds a plan allowance — gets a zero delta and is left
 * exactly as they were.
 */

/** Two Chimmy answers at 10 tokens each. */
export const DAILY_FREE_TOKENS = 20

/**
 * ⚠ THE DAY IS EASTERN, NOT UTC. This app already defines a sports day as an
 * Eastern day (`SPORTS_DAY_TIMEZONE` in lib/ai/deterministic.ts), and a US
 * fantasy audience resetting its free questions at 7pm local would read as a
 * bug. Any zone is arbitrary; matching the one the product already uses is not.
 */
const GRANT_TIMEZONE = 'America/New_York'

/** `YYYY-MM-DD` in the grant zone — the key that makes this once per day. */
export function grantDayKey(now: Date, timeZone: string = GRANT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function dailyGrantIdempotencyKey(userId: string, now: Date): string {
  return `free-daily:${userId}:${grantDayKey(now)}`
}

export type DailyGrantResult = {
  /** Tokens actually added. 0 when already at or above the floor. */
  granted: number
  /** Balance after this call, whether or not anything was added. */
  balance: number
  /** True when today's grant had already been consumed. */
  alreadyGrantedToday: boolean
}

/**
 * Top a user up to the daily free floor, at most once per day.
 *
 * ⚠ IDEMPOTENCY IS ENFORCED BY THE DATABASE, NOT BY A READ-THEN-WRITE.
 * `TokenLedger.idempotencyKey` is `@unique`, so two concurrent requests cannot
 * both grant — the loser hits the constraint. A check-then-insert would be a
 * race, and the failure mode of that race is free tokens forever.
 *
 * ⚠ THE LEDGER ROW IS WRITTEN EVEN WHEN THE DELTA IS ZERO, and that is the
 * whole mechanism. If we skipped the row for a user already at the floor, they
 * could spend down to nothing and be topped up again the same day — unlimited
 * questions, one refill at a time. Writing the row CONSUMES the day.
 *
 * Never throws: a failed grant must leave the caller to its normal
 * insufficient-balance handling rather than turning a chat message into a 500.
 */
export async function grantDailyFreeTokens(
  userId: string,
  now: Date = new Date(),
): Promise<DailyGrantResult> {
  const idempotencyKey = dailyGrantIdempotencyKey(userId, now)

  try {
    return await (prisma as any).$transaction(async (tx: any) => {
      const existing = await tx.tokenLedger.findUnique({
        where: { idempotencyKey },
        select: { balanceAfter: true },
      })
      if (existing) {
        const row = await tx.userTokenBalance.findUnique({
          where: { userId },
          select: { balance: true },
        })
        return {
          granted: 0,
          balance: Number(row?.balance ?? existing.balanceAfter ?? 0),
          alreadyGrantedToday: true,
        }
      }

      const balanceRow = await tx.userTokenBalance.upsert({
        where: { userId },
        update: {},
        create: { userId },
        select: { id: true, balance: true },
      })

      const balanceBefore = Number(balanceRow.balance ?? 0)
      /* A floor, so somebody already above it receives nothing. */
      const granted = Math.max(0, DAILY_FREE_TOKENS - balanceBefore)
      const balanceAfter = balanceBefore + granted

      if (granted > 0) {
        await tx.userTokenBalance.update({
          where: { id: balanceRow.id },
          data: { balance: { increment: granted } },
        })
      }

      /*
       * Written unconditionally — see the note above. `adjustment`, never
       * `purchase`: nobody bought these, and counting them as purchased would
       * corrupt `lifetimePurchased` and every revenue figure read off it.
       */
      await tx.tokenLedger.create({
        data: {
          userId,
          userTokenBalanceId: balanceRow.id,
          entryType: TOKEN_ENTRY_TYPES.ADJUSTMENT,
          tokenDelta: granted,
          balanceBefore,
          balanceAfter,
          sourceType: 'daily_free_grant',
          sourceId: grantDayKey(now),
          idempotencyKey,
          description: `Daily free allowance (${DAILY_FREE_TOKENS} token floor)`,
        },
      })

      return { granted, balance: balanceAfter, alreadyGrantedToday: false }
    })
  } catch {
    /*
     * Includes the unique-constraint loser in a race, which is a SUCCESS from
     * the user's point of view — somebody granted today's tokens. Report the
     * balance as it stands and let the caller proceed.
     */
    const row = await prisma.userTokenBalance
      .findUnique({ where: { userId }, select: { balance: true } })
      .catch(() => null)
    return {
      granted: 0,
      balance: Number(row?.balance ?? 0),
      alreadyGrantedToday: true,
    }
  }
}
