import { describe, expect, it } from 'vitest'
import { DEFAULT_PARTNER_SETTINGS, mergePartnerSettings, PartnerSettingsError, type PartnerSettings } from '@/lib/partner-codes/settings'
import {
  buildPayout,
  commissionBasisCents,
  discountedMonthlyCents,
  millicentsToCents,
  planAccrual,
  planReversal,
  previousMonthKey,
  reversalMillicents,
  withinCommissionCap,
  yearlyDiscountCents,
  type LedgerSlice,
} from '@/lib/partner-codes/money'
import { countMeters, paymentEarnsCommission, shouldUnlockCash, stepLevel, stepRewards, EMPTY_LEVEL } from '@/lib/partner-codes/meters'
import { checkCodeShape, normalizeCode } from '@/lib/partner-codes/code'
import { flagReasons, refuseRedemption } from '@/lib/partner-codes/fraud'

// The checks in the brief run on the GROSS basis with no fees.
const GROSS: PartnerSettings = { ...DEFAULT_PARTNER_SETTINGS, commissionBasis: 'gross' }
const PRO = 999
const COMMISH = 1499
const SUPREME = 1999
const SUPREME_YEAR = 15999

const day = (iso: string) => new Date(`${iso}T12:00:00Z`)

/** Commission for N identical monthly payments, in cents, summed exactly then rounded once. */
function monthlyCommissionCents(users: number, paidCents: number, s = GROSS): number {
  const one = planAccrual({ interval: 'month', basisCents: commissionBasisCents({ grossCents: paidCents, feeCents: 0, refundCents: 0 }, s), paidAt: day('2026-11-01'), settings: s })
  return millicentsToCents(one[0].commissionMillicents * users)
}

describe('friend discount', () => {
  it('AF Pro monthly costs $8.99 for the first 3 months', () => {
    expect(discountedMonthlyCents(PRO, GROSS)).toBe(899)
  })
  it('AF Supreme yearly, prorated: $4.00 off once (10% × 3/12 of $159.99)', () => {
    expect(yearlyDiscountCents(SUPREME_YEAR, GROSS)).toBe(400)
  })
  it('full_year mode takes 10% off the whole first year', () => {
    expect(yearlyDiscountCents(SUPREME_YEAR, { ...GROSS, yearlyDiscountMode: 'full_year' })).toBe(1600)
  })
})

describe('commission amounts (gross basis, no fees)', () => {
  it('1,000 AF Pro monthly at full price → $999.00 a month', () => {
    expect(monthlyCommissionCents(1000, PRO)).toBe(99_900)
  })
  it('1,000 AF Commissioner monthly → $1,499.00', () => {
    expect(monthlyCommissionCents(1000, COMMISH)).toBe(149_900)
  })
  it('1,000 AF Supreme monthly → $1,999.00', () => {
    expect(monthlyCommissionCents(1000, SUPREME)).toBe(199_900)
  })
  it('commission follows what was actually paid: 1,000 Pro in their discount months → $899.00', () => {
    expect(monthlyCommissionCents(1000, discountedMonthlyCents(PRO, GROSS))).toBe(89_900)
  })
  it('1,000 AF Supreme yearly at full price → $1,333.25 accrued each month', () => {
    const slices = planAccrual({ interval: 'year', basisCents: SUPREME_YEAR, paidAt: day('2026-01-15'), settings: GROSS })
    expect(slices).toHaveLength(12)
    expect(millicentsToCents(slices[0].commissionMillicents * 1000)).toBe(133_325)
  })
  it('first discounted year ($155.99) → $1,299.92 a month across 1,000 users, and the 12 slices sum exactly', () => {
    const paid = SUPREME_YEAR - yearlyDiscountCents(SUPREME_YEAR, GROSS)
    const slices = planAccrual({ interval: 'year', basisCents: paid, paidAt: day('2026-01-31'), settings: GROSS })
    expect(millicentsToCents(slices[0].commissionMillicents * 1000)).toBe(129_991)
    expect(slices.reduce((a, s) => a + s.commissionMillicents, 0)).toBe(paid * 10 * 10)
    // Month-end dates clamp instead of skipping February.
    expect(slices.map((s) => s.periodMonth).slice(0, 3)).toEqual(['2026-01', '2026-02', '2026-03'])
  })
  it('net basis subtracts the Stripe fee from each payment', () => {
    const net = { ...GROSS, commissionBasis: 'net' as const }
    const fee = Math.round(SUPREME * 0.029) + 30 // 88
    const basis = commissionBasisCents({ grossCents: SUPREME, feeCents: fee, refundCents: 0 }, net)
    expect(basis).toBe(1911)
    expect(planAccrual({ interval: 'month', basisCents: basis, paidAt: day('2026-11-01'), settings: net })[0].commissionMillicents).toBe(191_100)
  })
  it('app-store sale: 10% of what Apple pays after its 15%', () => {
    const net = { ...GROSS, commissionBasis: 'net' as const }
    const basis = commissionBasisCents({ grossCents: SUPREME, feeCents: Math.round(SUPREME * 0.15), refundCents: 0 }, net)
    expect(millicentsToCents(planAccrual({ interval: 'month', basisCents: basis, paidAt: day('2026-11-01'), settings: net })[0].commissionMillicents)).toBe(170)
  })
  it('an optional per-subscriber cap stops commission after N months', () => {
    expect(withinCommissionCap(500, GROSS)).toBe(true)
    expect(withinCommissionCap(11, { ...GROSS, commissionCapMonths: 12 })).toBe(true)
    expect(withinCommissionCap(12, { ...GROSS, commissionCapMonths: 12 })).toBe(false)
  })
})

describe('when cash starts', () => {
  it('below the paid-subscriber bar → $0, at the bar → on', () => {
    expect(shouldUnlockCash(null, GROSS.cashThresholdPaidSubs - 1, GROSS)).toBe(false)
    expect(shouldUnlockCash(null, GROSS.cashThresholdPaidSubs, GROSS)).toBe(true)
    expect(shouldUnlockCash(day('2026-10-01'), 50, GROSS)).toBe(false) // already on, stays on
  })
  it('only payments after the unlock moment earn — no back pay', () => {
    const unlocked = day('2026-11-10')
    expect(paymentEarnsCommission(day('2026-11-09'), unlocked)).toBe(false)
    expect(paymentEarnsCommission(day('2026-11-10'), unlocked)).toBe(true)
    expect(paymentEarnsCommission(day('2026-11-11'), null)).toBe(false)
  })
})

describe('refunds and chargebacks', () => {
  const slice = (id: string, installment: number, status: LedgerSlice['status'], m: number): LedgerSlice => ({ id, installment, status, commissionMillicents: m })

  it('a refunded monthly payment reverses its unpaid entry entirely', () => {
    const r = planReversal([slice('a', 0, 'accrued', 99_900)], reversalMillicents(99_900, 999, 999))
    expect(r).toEqual({ cancelIds: ['a'], clawbackMillicents: 0 })
  })
  it('refunded after payout → a negative entry on the next statement', () => {
    const r = planReversal([slice('a', 0, 'paid', 99_900)], 99_900)
    expect(r).toEqual({ cancelIds: [], clawbackMillicents: -99_900 })
  })
  it('yearly refunded in month 2: the 10 unpaid slices cancel, the 2 paid ones claw back', () => {
    const slices = planAccrual({ interval: 'year', basisCents: 12_000, paidAt: day('2026-01-01'), settings: GROSS })
      .map((p, i) => slice(`s${i}`, i, i < 2 ? 'paid' : 'scheduled', p.commissionMillicents))
    const total = slices.reduce((a, s) => a + s.commissionMillicents, 0)
    const r = planReversal(slices, reversalMillicents(total, 12_000, 12_000))
    expect(r.cancelIds).toHaveLength(10)
    expect(r.clawbackMillicents).toBe(-(slices[0].commissionMillicents + slices[1].commissionMillicents))
  })
  it('a partial refund undoes part, and cancelled + clawback always equals the reversal', () => {
    const slices = [0, 1, 2, 3].map((i) => slice(`s${i}`, i, i === 0 ? 'paid' : 'scheduled', 1000))
    const reverse = reversalMillicents(4000, 625, 1000) // 62.5% → 2500
    const r = planReversal(slices, reverse)
    const cancelled = r.cancelIds.length * 1000
    expect(cancelled - r.clawbackMillicents).toBe(reverse)
  })
})

describe('monthly statement', () => {
  it('is held when there is no W-9', () => {
    expect(buildPayout({ entriesMillicents: [99_900_000], hasTaxForm: false, settings: GROSS })).toMatchObject({ kind: 'payout', status: 'held' })
  })
  it('goes to review when the W-9 is on file', () => {
    expect(buildPayout({ entriesMillicents: [99_900_000], hasTaxForm: true, settings: GROSS })).toEqual({ kind: 'payout', totalCents: 99_900, status: 'pending_review', heldReason: null })
  })
  it('rolls over under the minimum, and a negative balance carries forward without a bill', () => {
    expect(buildPayout({ entriesMillicents: [1_000_000], hasTaxForm: true, settings: GROSS })).toMatchObject({ kind: 'none', reason: 'below_minimum' })
    expect(buildPayout({ entriesMillicents: [100_000, -5_000_000], hasTaxForm: true, settings: GROSS })).toMatchObject({ kind: 'none', reason: 'negative_balance' })
  })
  it('a run on Dec 1 closes November', () => {
    expect(previousMonthKey(day('2026-12-01'))).toBe('2026-11')
    expect(previousMonthKey(day('2027-01-01'))).toBe('2026-12')
  })
})

describe('meters and free plans', () => {
  const now = day('2026-11-23')
  const paid = (daysAgo: number, extra: Partial<Parameters<typeof countMeters>[0][number]> = {}) => ({
    status: 'pending' as const,
    firstPaidAt: new Date(now.getTime() - daysAgo * 86_400_000),
    currentlyPaying: true,
    activeDaysInWindow: 0,
    ...extra,
  })

  it('a subscriber counts once their first payment is 30 days old; flagged ones never count', () => {
    const m = countMeters([paid(31), paid(10), paid(40, { status: 'flagged' }), paid(40, { currentlyPaying: false })], now, GROSS)
    expect(m).toEqual({ paidSubs: 1, activeUsers: 1, pendingPaid: 1 })
  })
  it('free users count as active after 4 days in the last 28', () => {
    const free = { status: 'pending' as const, firstPaidAt: null, currentlyPaying: false, activeDaysInWindow: 4 }
    expect(countMeters([free, { ...free, activeDaysInWindow: 3 }], now, GROSS).activeUsers).toBe(1)
  })
  it('a level unlocks after holding its bar 30 days and survives a 30-day dip', () => {
    let st = stepLevel(EMPTY_LEVEL, true, day('2026-01-01'), 30, 30)
    expect(st.granted).toBe(false)
    st = stepLevel(st, true, day('2026-01-31'), 30, 30)
    expect(st.granted).toBe(true)
    st = stepLevel(st, false, day('2026-02-05'), 30, 30)
    expect(st.granted).toBe(true)
    st = stepLevel(st, false, day('2026-03-08'), 30, 30)
    expect(st.granted).toBe(false)
  })
  it('10 cleared paid subscribers give AF Supreme free straight away', () => {
    const levels = { commissionerActive: EMPTY_LEVEL, supremeActive: EMPTY_LEVEL, supremePaid: EMPTY_LEVEL }
    expect(stepRewards(levels, { paidSubs: 10, activeUsers: 10 }, now, GROSS).freePlan).toBe('supreme')
    expect(stepRewards(levels, { paidSubs: 0, activeUsers: 15 }, now, GROSS).freePlan).toBe('none') // still holding
  })
})

describe('codes and refusals', () => {
  it('keeps the casing you type and matches any casing', () => {
    expect(checkCodeShape('TheCiege')).toEqual({ ok: true, display: 'TheCiege', normalized: 'THECIEGE' })
    expect(normalizeCode('theciege')).toBe('THECIEGE')
  })
  it('refuses bad shapes, reserved words and betting words', () => {
    expect(checkCodeShape('abc')).toMatchObject({ ok: false, reason: 'length' })
    expect(checkCodeShape('the-ciege')).toMatchObject({ ok: false, reason: 'characters' })
    expect(checkCodeShape('Chimmy')).toMatchObject({ ok: false, reason: 'reserved' })
    expect(checkCodeShape('BetKing')).toMatchObject({ ok: false, reason: 'not_allowed' })
    expect(checkCodeShape('NiceCode', () => true)).toMatchObject({ ok: false, reason: 'not_allowed' })
  })
  it('blocks self-redemption and a second redemption', () => {
    expect(refuseRedemption({ redeemerUserId: 'u1', ownerUserId: 'u1', redeemerHasRedemption: false, codeStatus: 'active' })).toBe('own_code')
    expect(refuseRedemption({ redeemerUserId: 'u2', ownerUserId: 'u1', redeemerHasRedemption: true, codeStatus: 'active' })).toBe('already_redeemed')
    expect(refuseRedemption({ redeemerUserId: 'u2', ownerUserId: 'u1', redeemerHasRedemption: false, codeStatus: 'active' })).toBeNull()
  })
  it('flags shared cards, IP bursts and throwaway emails', () => {
    expect(flagReasons({ sameCardOnCode: 2, matchesOwnerCard: false, sameIpLast24h: 1, isDisposableEmail: true, matchesOwnerIp: false })).toEqual(['shared_card', 'disposable_email'])
  })
})

describe('admin settings', () => {
  it('validates edits and names the bad field', () => {
    expect(mergePartnerSettings(DEFAULT_PARTNER_SETTINGS, { commissionPercent: 12 }).commissionPercent).toBe(12)
    expect(() => mergePartnerSettings(DEFAULT_PARTNER_SETTINGS, { commissionPercent: 80 })).toThrow(PartnerSettingsError)
    expect(mergePartnerSettings(DEFAULT_PARTNER_SETTINGS, { commissionCapMonths: '' }).commissionCapMonths).toBeNull()
  })
})
