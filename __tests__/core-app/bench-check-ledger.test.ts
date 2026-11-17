import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The advice ledger's start/sit half (2026-11-14): My Team's bench check is recorded so it can be
 * graded. These pin WHEN a render may record (only the week being played, Sleeper, a full render) and
 * WHAT it sends (each swap with both projections, then a withdraw scoped to players still to play).
 */

const recordAdvice = vi.hoisted(() => vi.fn(async () => 'recorded'))
const withdrawStaleMyTeamAdvice = vi.hoisted(() => vi.fn(async () => 0))
vi.mock('@/lib/chimmy-advice/adviceStore', () => ({
  recordAdvice,
  withdrawStaleMyTeamAdvice,
  MY_TEAM_BENCH_SURFACE: 'my_team_bench',
}))

import { benchLedgerWeek, scheduleBenchCheckLedger, type BenchLedgerContext } from '@/lib/core-app/benchCheckLedger'

const CTX: BenchLedgerContext = {
  userId: 'u1',
  leagueId: 'lg',
  platform: 'sleeper',
  sport: 'NFL',
  projectionWeek: { season: '2026', week: 10 },
  sportsWeek: { season: 2026, week: 10 },
  fullRender: true,
}

describe('benchLedgerWeek — when a render may record', () => {
  it('records for the week being played, in a Sleeper league, on a full render', () => {
    expect(benchLedgerWeek(CTX, {} as NodeJS.ProcessEnv)).toEqual({ season: 2026, week: 10 })
  })

  it.each([
    ['the projection feed is on another week', { projectionWeek: { season: '2026', week: 9 } }],
    ['a different season', { sportsWeek: { season: 2025, week: 10 } }],
    ['no week known', { sportsWeek: null }],
    ['not Sleeper (the grade reads Sleeper scores)', { platform: 'espn' }],
    ['a saved-roster render, which shows no bench check', { fullRender: false }],
  ])('records nothing when %s', (_label, patch) => {
    expect(benchLedgerWeek({ ...CTX, ...(patch as Partial<BenchLedgerContext>) }, {} as NodeJS.ProcessEnv)).toBeNull()
  })

  it('ADVICE_LEDGER_MY_TEAM=off turns it off', () => {
    expect(benchLedgerWeek(CTX, { ADVICE_LEDGER_MY_TEAM: 'off' } as NodeJS.ProcessEnv)).toBeNull()
  })
})

describe('scheduleBenchCheckLedger — what it sends', () => {
  beforeEach(() => {
    recordAdvice.mockClear()
    withdrawStaleMyTeamAdvice.mockClear()
  })
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('records each swap with both projections, then withdraws what this render no longer says', async () => {
    scheduleBenchCheckLedger(
      CTX,
      [{ slot: 'WR', rec: { key: '1', name: 'Bench Guy', projected: 14.2 }, alt: { key: '2', name: 'Starter Guy', projected: 9.1 } }],
      ['1', '2', '3'],
    )
    await flush()
    await flush()
    expect(recordAdvice).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'my_team_bench',
        adviceType: 'start_sit',
        season: 2026,
        week: 10,
        rec: { key: '1', name: 'Bench Guy' },
        alt: { key: '2', name: 'Starter Guy' },
        slot: 'WR',
        projected: { rec: 14.2, alt: 9.1 },
      }),
    )
    expect(withdrawStaleMyTeamAdvice).toHaveBeenCalledWith({
      userId: 'u1', leagueId: 'lg', season: 2026, week: 10,
      keep: [{ rec: '1', alt: '2' }],
      openPlayerKeys: ['1', '2', '3'],
    })
  })

  it('with no swaps it still withdraws — a call that stopped being made is the case withdrawal exists for', async () => {
    scheduleBenchCheckLedger(CTX, [], ['1', '2'])
    await flush()
    expect(recordAdvice).not.toHaveBeenCalled()
    expect(withdrawStaleMyTeamAdvice).toHaveBeenCalledWith(expect.objectContaining({ keep: [] }))
  })

  it('never throws into the page when the store fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    recordAdvice.mockRejectedValueOnce(new Error('db down'))
    expect(() => scheduleBenchCheckLedger(CTX, [{ slot: null, rec: { key: '1', name: 'a', projected: 1 }, alt: { key: '2', name: 'b', projected: 0 } }], [])).not.toThrow()
    await flush()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('a render that may not record touches nothing', async () => {
    scheduleBenchCheckLedger({ ...CTX, platform: 'yahoo' }, [{ slot: null, rec: { key: '1', name: 'a', projected: 1 }, alt: { key: '2', name: 'b', projected: 0 } }], ['1'])
    await flush()
    expect(recordAdvice).not.toHaveBeenCalled()
    expect(withdrawStaleMyTeamAdvice).not.toHaveBeenCalled()
  })
})
