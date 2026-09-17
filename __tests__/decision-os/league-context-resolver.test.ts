import { describe, expect, it, vi } from 'vitest'
import {
  resolveLeagueFinancialContext,
  resolveLeagueFinancialContextSafely,
  type LeagueContextStoreDeps,
} from '@/lib/decision-os/leagueContext'

function fakeDeps(overrides: Partial<LeagueContextStoreDeps> = {}): LeagueContextStoreDeps {
  return {
    findContext: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}

describe('resolveLeagueFinancialContext', () => {
  it('returns the honest UNKNOWN default when no row exists', async () => {
    const deps = fakeDeps({ findContext: vi.fn().mockResolvedValue(null) })
    const context = await resolveLeagueFinancialContext('league-1', deps)
    expect(context).toEqual({
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

  it('maps a persisted row to a real, non-default context', async () => {
    const now = new Date('2026-07-09T00:00:00.000Z')
    const deps = fakeDeps({
      findContext: vi.fn().mockResolvedValue({
        leagueId: 'league-2',
        financialStatus: 'PAID',
        buyInAmount: 50,
        buyInCurrency: 'usd',
        escrowProvider: 'LEAGUESAFE',
        financialConfidence: 'USER_CONFIRMED',
        financialNotes: 'Venmo pool',
        isUserConfirmed: true,
        lastVerifiedAt: now,
      }),
    })
    const context = await resolveLeagueFinancialContext('league-2', deps)
    expect(context.financialStatus).toBe('PAID')
    expect(context.buyInAmount).toBe(50)
    expect(context.escrowProvider).toBe('LEAGUESAFE')
    expect(context.lastVerifiedAt).toBe(now)
  })

  it('degrades honestly to UNKNOWN when the store throws, never crashing the caller', async () => {
    const deps = fakeDeps({ findContext: vi.fn().mockRejectedValue(new Error('delegate not generated')) })
    const context = await resolveLeagueFinancialContext('league-3', deps)
    expect(context.financialStatus).toBe('UNKNOWN')
    expect(context.financialConfidence).toBe('UNKNOWN')
  })
})

describe('resolveLeagueFinancialContextSafely', () => {
  it('returns the same real context resolveLeagueFinancialContext would, for a persisted row', async () => {
    const deps = fakeDeps({
      findContext: vi.fn().mockResolvedValue({
        leagueId: 'league-8',
        financialStatus: 'FREE',
        buyInAmount: null,
        buyInCurrency: null,
        escrowProvider: 'UNKNOWN',
        financialConfidence: 'USER_CONFIRMED',
        financialNotes: null,
        isUserConfirmed: true,
        lastVerifiedAt: null,
      }),
    })
    const context = await resolveLeagueFinancialContextSafely('league-8', deps)
    expect(context?.financialStatus).toBe('FREE')
  })

  it('never throws even when the underlying store degrades — returns the honest UNKNOWN context, not null', async () => {
    const deps = fakeDeps({ findContext: vi.fn().mockRejectedValue(new Error('delegate not generated')) })
    const context = await resolveLeagueFinancialContextSafely('league-9', deps)
    // resolveLeagueFinancialContext already degrades internally to the honest UNKNOWN default rather
    // than throwing, so this defense-in-depth wrapper never actually needs its own catch branch today
    // — confirmed here so a future change to the inner function's contract would be caught by this test.
    expect(context).toEqual(
      expect.objectContaining({ leagueId: 'league-9', financialStatus: 'UNKNOWN' }),
    )
  })
})
