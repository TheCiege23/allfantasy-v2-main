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
    ['an NBA Sleeper league whose own week number happens to match the NFL\'s', { sport: 'NBA' }],
    ['an NHL Sleeper league on a matching week', { sport: 'nhl' }],
    ['a league with no sport', { sport: '' }],
    ['a saved-roster render, which shows no bench check', { fullRender: false }],
  ])('records nothing when %s', (_label, patch) => {
    expect(benchLedgerWeek({ ...CTX, ...(patch as Partial<BenchLedgerContext>) }, {} as NodeJS.ProcessEnv)).toBeNull()
  })

  it.each(['allfantasy', 'af', 'manual', 'native', 'AllFantasy'])(
    'records in a native NFL league (platform %s) — graded on our own engine\'s weekly scores',
    (platform) => {
      expect(benchLedgerWeek({ ...CTX, platform }, {} as NodeJS.ProcessEnv)).toEqual({ season: 2026, week: 10 })
    },
  )

  it.each([['yahoo'], ['mfl'], ['fleaflicker'], [''], [null]])('records nothing for platform %s (no stored weekly scores, or unknown)', (platform) => {
    expect(benchLedgerWeek({ ...CTX, platform }, {} as NodeJS.ProcessEnv)).toBeNull()
  })

  it('an NBA league with no priced period records nothing — whatever the NFL week says', () => {
    expect(benchLedgerWeek({ ...CTX, platform: 'allfantasy', sport: 'NBA' }, {} as NodeJS.ProcessEnv)).toBeNull()
  })
})

describe('benchLedgerWeek — NBA, NHL and MLB record on their own calendar (2026-11-23)', () => {
  const NBA: BenchLedgerContext = {
    ...CTX,
    sport: 'NBA',
    // The NFL week is 10 and so is nothing else: the call must be filed under the sport's own week 6.
    lineupPeriod: { kind: 'week', week: 6, season: 2026 },
  }

  it.each(['NBA', 'NHL', 'MLB'])('%s: records under the week My Team priced, in that sport\'s season', (sport) => {
    expect(benchLedgerWeek({ ...NBA, sport }, {} as NodeJS.ProcessEnv)).toEqual({ season: 2026, week: 6 })
    expect(benchLedgerWeek({ ...NBA, sport, platform: 'allfantasy' }, {} as NodeJS.ProcessEnv)).toEqual({ season: 2026, week: 6 })
  })

  it('🛑 never under the NFL week, even when the NFL weeks agree', () => {
    expect(benchLedgerWeek({ ...NBA, lineupPeriod: { kind: 'week', week: 10, season: 2026 } }, {} as NodeJS.ProcessEnv)).toEqual({ season: 2026, week: 10 })
    expect(benchLedgerWeek({ ...NBA, projectionWeek: { season: '2026', week: 3 }, sportsWeek: null }, {} as NodeJS.ProcessEnv)).toEqual({ season: 2026, week: 6 })
  })

  it.each([
    ['a daily-lineup league (one day priced; the ledger has no day)', { lineupPeriod: { kind: 'day' as const, week: 6, season: 2026 } }],
    ['a categories league (no period priced)', { lineupPeriod: null }],
    ['no season on the period', { lineupPeriod: { kind: 'week' as const, week: 6 } }],
    ['no week on the period', { lineupPeriod: { kind: 'week' as const, week: null, season: 2026 } }],
    ['ESPN', { platform: 'espn' }],
    ['a saved-roster render', { fullRender: false }],
  ])('records nothing for %s', (_label, patch) => {
    expect(benchLedgerWeek({ ...NBA, ...(patch as Partial<BenchLedgerContext>) }, {} as NodeJS.ProcessEnv)).toBeNull()
  })

  it('My Team hands the ledger the period it priced', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(`${process.cwd()}/lib/core-app/myTeam.ts`, 'utf8')
    const call = src.slice(src.indexOf('scheduleBenchCheckLedger(\n'), src.indexOf('ledgerCalls,', src.indexOf('scheduleBenchCheckLedger(\n')))
    expect(call).toMatch(/lineupPeriod: lineupPeriod \?\? null,/)
    const daily = readFileSync(`${process.cwd()}/lib/core-app/myTeamDailySport.ts`, 'utf8')
    expect(daily).toMatch(/season: outlook\.period\.season \?\? null/)
  })

  it('NCAAB and soccer still record nothing', () => {
    for (const sport of ['NCAAB', 'SOCCER', 'NCAAF']) expect(benchLedgerWeek({ ...NBA, sport }, {} as NodeJS.ProcessEnv)).toBeNull()
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
