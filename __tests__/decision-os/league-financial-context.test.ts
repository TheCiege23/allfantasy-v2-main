import { describe, expect, it } from 'vitest'
import {
  applyEscrowVerification,
  applyManualFinancialConfirmation,
  defaultLeagueFinancialContext,
  describeEscrowProvider,
  describeLeagueFinancialContext,
  isConfidentlyFree,
  isConfidentlyPaid,
  isFinancialStatusConfident,
  resetLeagueFinancialContext,
} from '@/lib/decision-os/leagueFinancialContext'

describe('defaultLeagueFinancialContext', () => {
  it('defaults a Sleeper import to fully unknown — never inferred', () => {
    const ctx = defaultLeagueFinancialContext('league-1', 'sleeper')
    expect(ctx).toEqual({
      leagueId: 'league-1',
      financialStatus: 'UNKNOWN',
      buyInAmount: null,
      buyInCurrency: null,
      escrowProvider: 'UNKNOWN',
      financialConfidence: 'UNKNOWN',
      financialNotes: null,
      isUserConfirmed: false,
      lastVerifiedAt: null,
    })
  })

  it('defaults every provider identically — no provider-specific heuristics exist', () => {
    const providers = ['sleeper', 'espn', 'yahoo', 'allfantasy', 'totally-unknown-provider', '']
    for (const provider of providers) {
      const ctx = defaultLeagueFinancialContext('league-x', provider)
      expect(ctx.financialStatus).toBe('UNKNOWN')
      expect(ctx.financialConfidence).toBe('UNKNOWN')
      expect(ctx.isUserConfirmed).toBe(false)
    }
  })
})

describe('applyManualFinancialConfirmation', () => {
  it('confirms a paid league with a real buy-in amount', () => {
    const now = new Date('2026-07-09T00:00:00.000Z')
    const start = defaultLeagueFinancialContext('league-1', 'sleeper')
    const confirmed = applyManualFinancialConfirmation(
      start,
      { financialStatus: 'PAID', buyInAmount: 50, buyInCurrency: 'usd', financialNotes: 'Venmo pool' },
      now,
    )
    expect(confirmed.financialStatus).toBe('PAID')
    expect(confirmed.buyInAmount).toBe(50)
    expect(confirmed.buyInCurrency).toBe('usd')
    expect(confirmed.financialNotes).toBe('Venmo pool')
    expect(confirmed.financialConfidence).toBe('USER_CONFIRMED')
    expect(confirmed.isUserConfirmed).toBe(true)
    expect(confirmed.lastVerifiedAt).toBe(now)
    expect(confirmed.escrowProvider).toBe('UNKNOWN')
  })

  it('confirms a free league context and clears any prior buy-in amount', () => {
    const now = new Date('2026-07-09T00:00:00.000Z')
    const start: ReturnType<typeof defaultLeagueFinancialContext> = {
      ...defaultLeagueFinancialContext('league-2', 'sleeper'),
      buyInAmount: 25,
      buyInCurrency: 'usd',
    }
    const confirmed = applyManualFinancialConfirmation(start, { financialStatus: 'FREE' }, now)
    expect(confirmed.financialStatus).toBe('FREE')
    expect(confirmed.buyInAmount).toBeNull()
    expect(confirmed.buyInCurrency).toBeNull()
    expect(confirmed.financialConfidence).toBe('USER_CONFIRMED')
    expect(confirmed.isUserConfirmed).toBe(true)
    expect(confirmed.lastVerifiedAt).toBe(now)
  })

  it('never produces VERIFIED_PAID or escrow-tier confidence from a manual confirmation alone', () => {
    const confirmed = applyManualFinancialConfirmation(
      defaultLeagueFinancialContext('league-3', 'sleeper'),
      { financialStatus: 'PAID', buyInAmount: 100 },
    )
    expect(confirmed.financialStatus).not.toBe('VERIFIED_PAID')
    expect(confirmed.financialConfidence).not.toBe('ESCROW_VERIFIED')
  })
})

describe('applyEscrowVerification', () => {
  it('produces a verified-paid context tied to a real escrow provider', () => {
    const now = new Date('2026-07-09T00:00:00.000Z')
    const start = defaultLeagueFinancialContext('league-4', 'sleeper')
    const verified = applyEscrowVerification(
      start,
      { escrowProvider: 'LEAGUESAFE', buyInAmount: 100, buyInCurrency: 'usd' },
      now,
    )
    expect(verified.financialStatus).toBe('VERIFIED_PAID')
    expect(verified.financialConfidence).toBe('ESCROW_VERIFIED')
    expect(verified.escrowProvider).toBe('LEAGUESAFE')
    expect(verified.buyInAmount).toBe(100)
    expect(verified.isUserConfirmed).toBe(true)
    expect(verified.lastVerifiedAt).toBe(now)
  })

  it('is the only path that reaches ESCROW_VERIFIED confidence', () => {
    const manual = applyManualFinancialConfirmation(defaultLeagueFinancialContext('league-5', 'sleeper'), {
      financialStatus: 'PAID',
    })
    const verified = applyEscrowVerification(manual, { escrowProvider: 'FANCRED' })
    expect(verified.financialConfidence).toBe('ESCROW_VERIFIED')
    expect(manual.financialConfidence).not.toBe('ESCROW_VERIFIED')
  })
})

describe('unknown context never fakes confidence', () => {
  it('a freshly defaulted context is never reported as confident, paid, or free', () => {
    const ctx = defaultLeagueFinancialContext('league-6', 'sleeper')
    expect(isFinancialStatusConfident(ctx)).toBe(false)
    expect(isConfidentlyPaid(ctx)).toBe(false)
    expect(isConfidentlyFree(ctx)).toBe(false)
  })

  it('a PAID status without real confidence (constructed directly, bypassing the helpers) is never treated as confidently paid', () => {
    const fabricated = { ...defaultLeagueFinancialContext('league-7', 'sleeper'), financialStatus: 'PAID' as const }
    // financialConfidence is still UNKNOWN — status alone must never imply confidence.
    expect(isConfidentlyPaid(fabricated)).toBe(false)
  })

  it('describes an unknown context honestly, without inventing a dollar amount or provider', () => {
    const ctx = defaultLeagueFinancialContext('league-8', 'sleeper')
    expect(describeLeagueFinancialContext(ctx)).toBe('Financial status unknown — no confirmation on file.')
  })
})

describe('describeLeagueFinancialContext', () => {
  it('describes a confirmed paid league with its real buy-in amount', () => {
    const confirmed = applyManualFinancialConfirmation(defaultLeagueFinancialContext('league-9', 'sleeper'), {
      financialStatus: 'PAID',
      buyInAmount: 50,
      buyInCurrency: 'usd',
    })
    expect(describeLeagueFinancialContext(confirmed)).toBe('Paid league — USD 50 buy-in, confirmed by commissioner.')
  })

  it('describes a verified-paid league with its real escrow provider', () => {
    const verified = applyEscrowVerification(defaultLeagueFinancialContext('league-10', 'sleeper'), {
      escrowProvider: 'LEAGUESAFE',
      buyInAmount: 100,
      buyInCurrency: 'usd',
    })
    expect(describeLeagueFinancialContext(verified)).toBe(
      'Verified paid league — USD 100 buy-in, confirmed via LeagueSafe.',
    )
  })

  it('describes a confirmed free league', () => {
    const free = applyManualFinancialConfirmation(defaultLeagueFinancialContext('league-11', 'sleeper'), {
      financialStatus: 'FREE',
    })
    expect(describeLeagueFinancialContext(free)).toBe('Free league — confirmed by commissioner.')
  })
})

describe('describeEscrowProvider', () => {
  it('labels every provider, including the unknown sentinel', () => {
    expect(describeEscrowProvider('LEAGUESAFE')).toBe('LeagueSafe')
    expect(describeEscrowProvider('FANCRED')).toBe('FanCred')
    expect(describeEscrowProvider('YAHOO')).toBe('Yahoo')
    expect(describeEscrowProvider('ESPN')).toBe('ESPN')
    expect(describeEscrowProvider('MANUAL')).toBe('Manually recorded')
    expect(describeEscrowProvider('OTHER')).toBe('Other provider')
    expect(describeEscrowProvider('UNKNOWN')).toBe('Unknown provider')
  })
})

describe('applyManualFinancialConfirmation — optional escrowProvider label (Phase OS-A2)', () => {
  it('records an escrow provider label on a manual paid confirmation without implying verification', () => {
    const confirmed = applyManualFinancialConfirmation(defaultLeagueFinancialContext('league-12', 'sleeper'), {
      financialStatus: 'PAID',
      buyInAmount: 50,
      escrowProvider: 'LEAGUESAFE',
    })
    expect(confirmed.escrowProvider).toBe('LEAGUESAFE')
    // Confidence stays USER_CONFIRMED, never ESCROW_VERIFIED — a label is not a verification.
    expect(confirmed.financialConfidence).toBe('USER_CONFIRMED')
    expect(confirmed.financialStatus).toBe('PAID')
  })

  it('forces escrowProvider back to UNKNOWN when confirming free, even if one was previously set', () => {
    const paid = applyManualFinancialConfirmation(defaultLeagueFinancialContext('league-13', 'sleeper'), {
      financialStatus: 'PAID',
      escrowProvider: 'FANCRED',
    })
    const free = applyManualFinancialConfirmation(paid, { financialStatus: 'FREE' })
    expect(free.escrowProvider).toBe('UNKNOWN')
  })
})

describe('resetLeagueFinancialContext (Phase OS-A2)', () => {
  it('returns a fully unknown context, identical to a fresh default', () => {
    const reset = resetLeagueFinancialContext('league-14', 'sleeper')
    expect(reset).toEqual(defaultLeagueFinancialContext('league-14', 'sleeper'))
  })

  it('fully clears every field of a previously-confirmed paid context, not just financialStatus', () => {
    const paid = applyManualFinancialConfirmation(defaultLeagueFinancialContext('league-15', 'sleeper'), {
      financialStatus: 'PAID',
      buyInAmount: 100,
      buyInCurrency: 'usd',
      financialNotes: 'Venmo pool',
      escrowProvider: 'LEAGUESAFE',
    })
    const reset = resetLeagueFinancialContext(paid.leagueId, 'sleeper')
    expect(reset.financialStatus).toBe('UNKNOWN')
    expect(reset.buyInAmount).toBeNull()
    expect(reset.buyInCurrency).toBeNull()
    expect(reset.financialNotes).toBeNull()
    expect(reset.escrowProvider).toBe('UNKNOWN')
    expect(reset.financialConfidence).toBe('UNKNOWN')
    expect(reset.isUserConfirmed).toBe(false)
    expect(reset.lastVerifiedAt).toBeNull()
  })
})
