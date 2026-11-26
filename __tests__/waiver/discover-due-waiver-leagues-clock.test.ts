import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Two ways the waiver cron used to get a league's timing wrong (2026-11-26):
 *  - no `nextRunAt` (never written at create) read as "due now", so a new league's first claims settled
 *    at the next 5-minute tick, ignoring the schedule;
 *  - a WaiverRun left "running" by a run that died was never closed, and the league was skipped forever.
 */

const h = vi.hoisted(() => ({
  state: null as null | { nextRunAt: Date | null; processingLocked: boolean },
  refresh: vi.fn(async (): Promise<Date | null> => null),
  runningFindFirst: vi.fn(async (): Promise<{ id: string } | null> => null),
  updateMany: vi.fn(async () => ({ count: 0 })),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    waiverClaim: { groupBy: async () => [{ leagueId: 'L1', _count: { _all: 2 } }], count: async () => 0 },
    waiverRun: { findFirst: h.runningFindFirst, updateMany: h.updateMany },
    league: { findUnique: async () => ({ sport: 'NFL', guillotineMode: null, leagueVariant: null, leagueType: 'redraft', platform: 'native' }) },
  },
}))
vi.mock('@/lib/waiver-wire/settings-service', () => ({
  getEffectiveLeagueWaiverSettings: async () => ({ normalizedWaiverType: 'faab', waiverType: 'faab' }),
}))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({
  getLeagueWaiverState: async () => h.state,
  refreshLeagueWaiverNextRunAt: h.refresh,
}))
vi.mock('@/lib/guillotine/blindWaiverCutoff', () => ({ guillotineClaimsCutoff: async () => null, isBlindAuctionLeague: () => false }))
vi.mock('@/lib/league/nativeFormatPatch', () => ({ nativeGuillotineState: () => false }))

import { STALE_RUNNING_WAIVER_RUN_MS, discoverDueWaiverLeagues } from '@/lib/automation/jobs/waivers/discoverDueWaiverLeagues'

const now = new Date('2026-11-26T18:00:00.000Z')

beforeEach(() => {
  h.state = null
  h.refresh.mockReset().mockResolvedValue(null)
  h.runningFindFirst.mockReset().mockResolvedValue(null)
  h.updateMany.mockReset().mockResolvedValue({ count: 0 })
})

describe('waiver cron discovery keeps to the schedule', () => {
  it('a league with no nextRunAt waits for its scheduled run instead of settling now', async () => {
    h.refresh.mockResolvedValue(new Date('2026-12-02T08:00:00.000Z'))
    expect(await discoverDueWaiverLeagues({ now })).toEqual([])
    expect(h.refresh).toHaveBeenCalledWith('L1', now)
  })

  it('once that scheduled time has passed, it is due', async () => {
    h.refresh.mockResolvedValue(new Date('2026-11-26T17:00:00.000Z'))
    const due = await discoverDueWaiverLeagues({ now })
    expect(due.map((d) => d.leagueId)).toEqual(['L1'])
    expect(due[0]!.metadata).toMatchObject({ discoveryReason: 'next_run_at_elapsed' })
  })

  it('only a league with no schedule at all keeps the run-now fallback', async () => {
    const due = await discoverDueWaiverLeagues({ now })
    expect(due[0]!.metadata).toMatchObject({ discoveryReason: 'pending_claims_no_next_run_at_fallback' })
  })

  it('closes a run that died "running" long ago, and still evaluates the league', async () => {
    h.state = { nextRunAt: new Date('2026-11-26T17:00:00.000Z'), processingLocked: false }
    const due = await discoverDueWaiverLeagues({ now })
    expect(h.updateMany).toHaveBeenCalledWith({
      where: { leagueId: 'L1', status: 'running', runAt: { lt: new Date(now.getTime() - STALE_RUNNING_WAIVER_RUN_MS) } },
      data: { status: 'failed' },
    })
    expect(due.map((d) => d.leagueId)).toEqual(['L1'])
  })

  it('a run started inside the budget is a live run: the league waits for it', async () => {
    h.state = { nextRunAt: new Date('2026-11-26T17:00:00.000Z'), processingLocked: false }
    h.runningFindFirst.mockResolvedValue({ id: 'live-run' })
    expect(await discoverDueWaiverLeagues({ now })).toEqual([])
  })
})
