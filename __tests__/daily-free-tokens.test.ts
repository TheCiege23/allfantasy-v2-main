import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The free Chimmy floor — `lib/tokens/dailyFreeTokens.ts`.
 *
 * ⚠ THIS FILE WAS REWRITTEN ON 2026-08-28 BECAUSE THE MODULE UNDER IT WAS.
 *
 * It previously tested a richer API — `DAILY_FREE_TOKENS`, `TRIAL_DAILY_FREE_TOKENS`,
 * `dailyFloorFor`, `grantDayKey`, `dailyGrantIdempotencyKey`, an Eastern-midnight reset
 * and a five-answer trial floor. Commit 8dd8e29c5 rewrote the module from scratch,
 * removing all of it, while its message said the module "was never written": that
 * session was working from a base 19 hours stale and did not see b1819ed4e/129441a13.
 * Seventeen tests went red and nothing else noticed, because no production code imports
 * the deleted symbols and vitest does not run in CI.
 *
 * The trial floor is NOT restored here — that is a spend decision (worst case
 * AI_TRIAL_DAYS x 50 tokens per new account, with signup open) and the trial's user-facing
 * claims were removed instead. These tests cover the module that actually exists, because
 * it is on a money path and the previous version's real value was catching exactly that.
 */

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  ruleFindUnique: vi.fn(),
  ledgerFindUnique: vi.fn(),
  ledgerCreate: vi.fn(),
  balanceUpsert: vi.fn(),
  balanceUpdate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: h.transaction,
    tokenSpendRule: { findUnique: h.ruleFindUnique },
  },
}))

import { FREE_CHIMMY_QUESTIONS_PER_DAY, grantDailyFreeTokens } from '@/lib/tokens/dailyFreeTokens'

const COST = 10
const FLOOR = COST * FREE_CHIMMY_QUESTIONS_PER_DAY
const NOW = new Date('2026-09-14T18:00:00Z')

/** Runs the callback against a fake tx, the way $transaction does. */
function withTx() {
  h.transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn({
      tokenLedger: { findUnique: h.ledgerFindUnique, create: h.ledgerCreate },
      userTokenBalance: { upsert: h.balanceUpsert, update: h.balanceUpdate },
    }),
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  withTx()
  h.ruleFindUnique.mockResolvedValue({ tokenCost: COST })
  h.ledgerFindUnique.mockResolvedValue(null)
  h.ledgerCreate.mockResolvedValue({})
  h.balanceUpdate.mockResolvedValue({})
  h.balanceUpsert.mockResolvedValue({ id: 'bal-1', balance: 0 })
})

describe('grantDailyFreeTokens', () => {
  it('lifts an empty account to the floor', async () => {
    const res = await grantDailyFreeTokens('u1', NOW)

    expect(res).toEqual({ granted: FLOOR, reason: 'granted' })
    expect(h.balanceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { balance: { increment: FLOOR } } }),
    )
  })

  it('tops UP to the floor rather than adding to it', async () => {
    // The money bug this guards: adding the floor daily lets anyone bank a fortnight
    // of questions by not asking any. Two a day means two a day.
    h.balanceUpsert.mockResolvedValue({ id: 'bal-1', balance: 12 })

    const res = await grantDailyFreeTokens('u1', NOW)

    expect(res).toEqual({ granted: FLOOR - 12, reason: 'granted' })
  })

  it('gives nothing to an account already at or above the floor', async () => {
    h.balanceUpsert.mockResolvedValue({ id: 'bal-1', balance: FLOOR + 500 })

    const res = await grantDailyFreeTokens('u1', NOW)

    expect(res).toEqual({ granted: 0, reason: 'at_or_above_floor' })
    expect(h.balanceUpdate).not.toHaveBeenCalled()
    expect(h.ledgerCreate).not.toHaveBeenCalled()
  })

  it('does not consume the day when it grants nothing', async () => {
    /*
     * Deliberate: a paying user above the floor has taken nothing, so if they spend
     * down later the same day they still get their one top-up. Writing the key here
     * would silently cost them it.
     */
    h.balanceUpsert.mockResolvedValue({ id: 'bal-1', balance: FLOOR })

    await grantDailyFreeTokens('u1', NOW)

    expect(h.ledgerCreate).not.toHaveBeenCalled()
  })

  it('does nothing the second time the same day', async () => {
    h.ledgerFindUnique.mockResolvedValue({ id: 'ledger-1' })

    const res = await grantDailyFreeTokens('u1', NOW)

    expect(res).toEqual({ granted: 0, reason: 'already_granted_today' })
    expect(h.balanceUpdate).not.toHaveBeenCalled()
  })

  it('keys the grant per user per UTC day', async () => {
    await grantDailyFreeTokens('u1', NOW)
    const firstKey = h.ledgerCreate.mock.calls[0][0].data.idempotencyKey

    vi.clearAllMocks()
    withTx()
    h.ruleFindUnique.mockResolvedValue({ tokenCost: COST })
    h.ledgerFindUnique.mockResolvedValue(null)
    h.balanceUpsert.mockResolvedValue({ id: 'bal-2', balance: 0 })
    await grantDailyFreeTokens('u2', NOW)
    const otherUserKey = h.ledgerCreate.mock.calls[0][0].data.idempotencyKey

    expect(firstKey).toContain('u1')
    expect(firstKey).toContain('2026-09-14')
    expect(otherUserKey).not.toBe(firstKey)
  })

  it('records an adjustment, never a purchase', async () => {
    // A purchase entry would misreport granted tokens as revenue.
    await grantDailyFreeTokens('u1', NOW)

    const entry = h.ledgerCreate.mock.calls[0][0].data
    expect(entry.entryType).toBe('adjustment')
    expect(entry.sourceType).toBe('daily_free_tokens')
    expect(entry.balanceBefore).toBe(0)
    expect(entry.balanceAfter).toBe(FLOOR)
  })

  it('treats a lost race as already granted rather than throwing', async () => {
    // The unique idempotencyKey IS the lock; P2002 means the other transaction paid out.
    h.transaction.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))

    await expect(grantDailyFreeTokens('u1', NOW)).resolves.toEqual({
      granted: 0,
      reason: 'already_granted_today',
    })
  })

  it('rethrows a real failure instead of disguising it as a quiet success', async () => {
    /*
     * The caller wraps this in `.catch(() => null)`, so swallowing everything here
     * would turn a broken grant into a silent zero balance — the exact failure mode
     * that left 32 of 34 accounts unable to ask a question.
     */
    h.transaction.mockRejectedValue(Object.assign(new Error('db down'), { code: 'P1001' }))

    await expect(grantDailyFreeTokens('u1', NOW)).rejects.toThrow('db down')
  })

  it('grants NOTHING when the spend rule is missing, rather than inventing a price', async () => {
    h.ruleFindUnique.mockResolvedValue(null)

    const res = await grantDailyFreeTokens('u1', NOW)

    expect(res).toEqual({ granted: 0, reason: 'no_spend_rule' })
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('tracks the spend rule, so re-pricing a message moves the floor with it', async () => {
    h.ruleFindUnique.mockResolvedValue({ tokenCost: 25 })

    const res = await grantDailyFreeTokens('u1', NOW)

    expect(res).toEqual({ granted: 25 * FREE_CHIMMY_QUESTIONS_PER_DAY, reason: 'granted' })
  })

  it('buys exactly two Chimmy answers at the current price', () => {
    expect(FREE_CHIMMY_QUESTIONS_PER_DAY).toBe(2)
  })
})
