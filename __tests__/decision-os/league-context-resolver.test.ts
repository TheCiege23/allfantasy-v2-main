import { describe, expect, it, vi } from 'vitest'
import {
  LeagueContextStoreUnavailableError,
  persistLeagueFinancialConfirmation,
  resolveLeagueFinancialContext,
  resolveLeagueFinancialContextSafely,
  type LeagueContextStoreDeps,
} from '@/lib/decision-os/leagueContext'

function fakeDeps(overrides: Partial<LeagueContextStoreDeps> = {}): LeagueContextStoreDeps {
  return {
    findContext: vi.fn().mockResolvedValue(null),
    upsertContext: vi.fn().mockResolvedValue(undefined),
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

describe('persistLeagueFinancialConfirmation', () => {
  it('confirms a paid context and persists it via upsertContext', async () => {
    const upsertContext = vi.fn().mockResolvedValue(undefined)
    const deps = fakeDeps({ findContext: vi.fn().mockResolvedValue(null), upsertContext })

    const result = await persistLeagueFinancialConfirmation(
      'league-4',
      { type: 'confirm', input: { financialStatus: 'PAID', buyInAmount: 25, buyInCurrency: 'usd' } },
      deps,
      new Date('2026-07-09T00:00:00.000Z'),
    )

    expect(result.financialStatus).toBe('PAID')
    expect(result.financialConfidence).toBe('USER_CONFIRMED')
    expect(upsertContext).toHaveBeenCalledWith('league-4', expect.objectContaining({ financialStatus: 'PAID' }))
  })

  it('confirms a free context and persists it', async () => {
    const upsertContext = vi.fn().mockResolvedValue(undefined)
    const deps = fakeDeps({ upsertContext })

    const result = await persistLeagueFinancialConfirmation(
      'league-5',
      { type: 'confirm', input: { financialStatus: 'FREE' } },
      deps,
    )

    expect(result.financialStatus).toBe('FREE')
    expect(upsertContext).toHaveBeenCalledWith('league-5', expect.objectContaining({ financialStatus: 'FREE' }))
  })

  it('resets an existing paid context back to UNKNOWN and persists the reset', async () => {
    const upsertContext = vi.fn().mockResolvedValue(undefined)
    const deps = fakeDeps({
      findContext: vi.fn().mockResolvedValue({
        leagueId: 'league-6',
        financialStatus: 'PAID',
        buyInAmount: 100,
        buyInCurrency: 'usd',
        escrowProvider: 'UNKNOWN',
        financialConfidence: 'USER_CONFIRMED',
        financialNotes: null,
        isUserConfirmed: true,
        lastVerifiedAt: new Date(),
      }),
      upsertContext,
    })

    const result = await persistLeagueFinancialConfirmation('league-6', { type: 'reset' }, deps)

    expect(result.financialStatus).toBe('UNKNOWN')
    expect(result.financialConfidence).toBe('UNKNOWN')
    expect(result.buyInAmount).toBeNull()
    expect(upsertContext).toHaveBeenCalledWith('league-6', expect.objectContaining({ financialStatus: 'UNKNOWN' }))
  })

  it('throws LeagueContextStoreUnavailableError when the store cannot persist, rather than reporting false success', async () => {
    const deps = fakeDeps({
      findContext: vi.fn().mockResolvedValue(null),
      upsertContext: vi.fn().mockRejectedValue(new LeagueContextStoreUnavailableError()),
    })

    await expect(
      persistLeagueFinancialConfirmation('league-7', { type: 'confirm', input: { financialStatus: 'PAID' } }, deps),
    ).rejects.toBeInstanceOf(LeagueContextStoreUnavailableError)
  })
})
