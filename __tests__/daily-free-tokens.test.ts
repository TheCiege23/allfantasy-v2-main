import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  appUserFindUnique: vi.fn(),
  ledgerFindUnique: vi.fn(),
  ledgerCreate: vi.fn(),
  balanceUpsert: vi.fn(),
  balanceUpdate: vi.fn(),
  balanceFindUnique: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: h.transaction,
    userTokenBalance: { findUnique: h.balanceFindUnique },
  },
}))

import {
  DAILY_FREE_TOKENS,
  TRIAL_DAILY_FREE_TOKENS,
  dailyFloorFor,
  grantDailyFreeTokens,
  grantDayKey,
  dailyGrantIdempotencyKey,
} from '@/lib/tokens/dailyFreeTokens'

/** Runs the callback against a fake tx, the way $transaction would. */
function withTx() {
  h.transaction.mockImplementation((fn: any) =>
    fn({
      tokenLedger: { findUnique: h.ledgerFindUnique, create: h.ledgerCreate },
      userTokenBalance: {
        upsert: h.balanceUpsert,
        update: h.balanceUpdate,
        findUnique: h.balanceFindUnique,
      },
      appUser: { findUnique: h.appUserFindUnique },
    }),
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  withTx()
  h.ledgerFindUnique.mockResolvedValue(null)
  /* Default: an old account, so the FREE floor applies unless a test says otherwise. */
  h.appUserFindUnique.mockResolvedValue({ createdAt: new Date('2020-01-01T00:00:00Z') })
  h.ledgerCreate.mockResolvedValue({})
  h.balanceUpdate.mockResolvedValue({})
})

describe('the day key', () => {
  /*
   * ⚠ EASTERN, NOT UTC. A US fantasy audience resetting its free questions at
   * 7pm local would read as a bug. 03:00 UTC is still the previous Eastern day.
   */
  it('rolls at Eastern midnight, not UTC midnight', () => {
    expect(grantDayKey(new Date('2026-08-28T03:00:00Z'))).toBe('2026-08-27')
    expect(grantDayKey(new Date('2026-08-28T05:00:00Z'))).toBe('2026-08-28')
  })

  it('keys the grant per user per day', () => {
    const k = dailyGrantIdempotencyKey('u1', new Date('2026-08-28T05:00:00Z'))
    expect(k).toBe('free-daily:u1:2026-08-28')
    expect(dailyGrantIdempotencyKey('u2', new Date('2026-08-28T05:00:00Z'))).not.toBe(k)
  })
})

describe('grantDailyFreeTokens', () => {
  it('lifts an empty account to the floor', async () => {
    h.balanceUpsert.mockResolvedValue({ id: 'b1', balance: 0 })

    const out = await grantDailyFreeTokens('u1', new Date('2026-08-28T15:00:00Z'))

    expect(out.granted).toBe(DAILY_FREE_TOKENS)
    expect(out.balance).toBe(DAILY_FREE_TOKENS)
    expect(h.balanceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { balance: { increment: DAILY_FREE_TOKENS } } }),
    )
  })

  /*
   * ⚠ A FLOOR, NOT AN ALLOWANCE THAT ACCUMULATES. Adding 20 a day would let
   * someone bank a fortnight of questions by not asking any — a different
   * product from "two a day".
   */
  it('tops UP to the floor rather than adding to it', async () => {
    h.balanceUpsert.mockResolvedValue({ id: 'b1', balance: 12 })

    const out = await grantDailyFreeTokens('u1', new Date('2026-08-28T15:00:00Z'))

    expect(out.granted).toBe(8)
    expect(out.balance).toBe(DAILY_FREE_TOKENS)
  })

  /* Somebody who paid is above the floor and must be left alone. */
  it('gives nothing to an account already above the floor', async () => {
    h.balanceUpsert.mockResolvedValue({ id: 'b1', balance: 500 })

    const out = await grantDailyFreeTokens('u1', new Date('2026-08-28T15:00:00Z'))

    expect(out.granted).toBe(0)
    expect(out.balance).toBe(500)
    expect(h.balanceUpdate).not.toHaveBeenCalled()
  })

  /*
   * ⚠ THE LEDGER ROW IS WHAT CONSUMES THE DAY. Skipping it for a user already
   * at the floor would let them spend to zero and be topped up again the same
   * day — unlimited questions, one refill at a time.
   */
  it('writes the ledger row even when it grants nothing', async () => {
    h.balanceUpsert.mockResolvedValue({ id: 'b1', balance: 500 })

    await grantDailyFreeTokens('u1', new Date('2026-08-28T15:00:00Z'))

    expect(h.ledgerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tokenDelta: 0, sourceType: 'daily_free_grant' }),
      }),
    )
  })

  /* Free tokens are not revenue; counting them as purchased corrupts reporting. */
  it('records an adjustment, never a purchase', async () => {
    h.balanceUpsert.mockResolvedValue({ id: 'b1', balance: 0 })

    await grantDailyFreeTokens('u1', new Date('2026-08-28T15:00:00Z'))

    expect(h.ledgerCreate.mock.calls[0][0].data.entryType).toBe('adjustment')
  })

  it('does nothing the second time the same day', async () => {
    h.ledgerFindUnique.mockResolvedValue({ balanceAfter: 20 })
    h.balanceFindUnique.mockResolvedValue({ balance: 10 })

    const out = await grantDailyFreeTokens('u1', new Date('2026-08-28T15:00:00Z'))

    expect(out.alreadyGrantedToday).toBe(true)
    expect(out.granted).toBe(0)
    /* Reports the CURRENT balance (already spent down), not the granted total. */
    expect(out.balance).toBe(10)
    expect(h.ledgerCreate).not.toHaveBeenCalled()
  })

  /*
   * ⚠ THE LOSER OF A UNIQUE-KEY RACE IS A SUCCESS, not an error: somebody
   * granted today's tokens. And a grant failure must never turn a chat message
   * into a 500.
   */
  it('never throws, and treats a race loss as already granted', async () => {
    h.transaction.mockRejectedValue(new Error('unique constraint violation'))
    h.balanceFindUnique.mockResolvedValue({ balance: 20 })

    const out = await grantDailyFreeTokens('u1', new Date('2026-08-28T15:00:00Z'))

    expect(out.alreadyGrantedToday).toBe(true)
    expect(out.balance).toBe(20)
  })

  it('buys exactly two Chimmy answers at the current price', () => {
    expect(DAILY_FREE_TOKENS).toBe(20)
  })
})

/*
 * ⚠ THE TRIAL WAS ADVERTISED AND GRANTED NOTHING. The shell rendered
 * "Trial · Nd left" from AIAccessResolver while the chat route never consulted
 * it, so a trialling user hit the same empty balance as everyone else.
 */
describe('the trial floor', () => {
  const inTrial = new Date('2026-08-25T00:00:00Z') // 3 days old; trial is 10
  const expired = new Date('2020-01-01T00:00:00Z')
  const now = new Date('2026-08-28T15:00:00Z')

  it('is higher than the free floor, and expires with the trial', () => {
    expect(TRIAL_DAILY_FREE_TOKENS).toBeGreaterThan(DAILY_FREE_TOKENS)
    expect(dailyFloorFor(inTrial, now)).toBe(TRIAL_DAILY_FREE_TOKENS)
    expect(dailyFloorFor(expired, now)).toBe(DAILY_FREE_TOKENS)
  })

  /* An unknown signup date must not silently buy the richer floor. */
  it('falls back to the free floor when the signup date is unknown', () => {
    expect(dailyFloorFor(null, now)).toBe(DAILY_FREE_TOKENS)
  })

  it('tops a trialling account up to the trial floor', async () => {
    h.appUserFindUnique.mockResolvedValue({ createdAt: inTrial })
    h.balanceUpsert.mockResolvedValue({ id: 'b1', balance: 0 })

    const out = await grantDailyFreeTokens('u1', now)

    expect(out.granted).toBe(TRIAL_DAILY_FREE_TOKENS)
    expect(out.floor).toBe(TRIAL_DAILY_FREE_TOKENS)
  })

  it('drops back to the free floor once the trial ends', async () => {
    h.appUserFindUnique.mockResolvedValue({ createdAt: expired })
    h.balanceUpsert.mockResolvedValue({ id: 'b1', balance: 0 })

    const out = await grantDailyFreeTokens('u1', now)

    expect(out.granted).toBe(DAILY_FREE_TOKENS)
  })

  /*
   * ⚠ A LAPSED TRIAL MUST NOT CLAW ANYTHING BACK. The floor only ever adds, so
   * someone who ends their trial holding 50 keeps all 50.
   */
  it('never removes tokens when the floor drops', async () => {
    h.appUserFindUnique.mockResolvedValue({ createdAt: expired })
    h.balanceUpsert.mockResolvedValue({ id: 'b1', balance: 50 })

    const out = await grantDailyFreeTokens('u1', now)

    expect(out.granted).toBe(0)
    expect(out.balance).toBe(50)
    expect(h.balanceUpdate).not.toHaveBeenCalled()
  })

  it('labels the ledger entry as the trial allowance', async () => {
    h.appUserFindUnique.mockResolvedValue({ createdAt: inTrial })
    h.balanceUpsert.mockResolvedValue({ id: 'b1', balance: 0 })

    await grantDailyFreeTokens('u1', now)

    expect(h.ledgerCreate.mock.calls[0][0].data.description).toMatch(/trial/i)
  })
})
