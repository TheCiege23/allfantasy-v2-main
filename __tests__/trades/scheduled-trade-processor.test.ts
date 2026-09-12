import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 WHAT THESE GUARD. A league with `processingDelayHours > 0` parks an accepted trade at
 * `status: 'scheduled'` and returns. Before this sweep existed, nothing in the codebase ever
 * queried for due trades — `scheduledProcessAt` appeared only inside two guards in the very
 * function that would have to be called again — so the trade sat there forever and the rosters
 * never moved.
 *
 * The wiring test at the bottom is the one that is easy to leave out and expensive to leave out:
 * a processor with no scheduled caller is the same bug wearing a different hat.
 */

const findManyMock = vi.fn()
const historyFindFirstMock = vi.fn()
const finalizeMock = vi.fn()
const appendProcessingEventMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    afLeagueTrade: { findMany: findManyMock },
    afLeagueTradeStatusHistory: { findFirst: historyFindFirstMock },
  },
}))

vi.mock('@/lib/league-trade-engine/tradeService', () => ({
  finalizeAfLeagueTradeProcessing: finalizeMock,
}))

vi.mock('@/lib/league-trade-engine/tradeAudit', () => ({
  appendAfTradeProcessingEvent: appendProcessingEventMock,
}))

const NOW = new Date('2026-09-12T18:00:00.000Z')

describe('scheduled trade processor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findManyMock.mockResolvedValue([])
    historyFindFirstMock.mockResolvedValue(null)
    finalizeMock.mockResolvedValue(undefined)
    appendProcessingEventMock.mockResolvedValue(undefined)
  })

  it('asks only for scheduled trades whose due time has passed, oldest first and bounded', async () => {
    const { processDueScheduledTrades, DEFAULT_SCHEDULED_TRADE_LIMIT } = await import(
      '@/lib/automation/jobs/trades/processDueScheduledTrades'
    )

    await processDueScheduledTrades({ now: NOW })

    expect(findManyMock).toHaveBeenCalledTimes(1)
    const args = findManyMock.mock.calls[0][0]
    // A sweep that selected any other status, or omitted the time bound, would execute trades
    // BEFORE the delay the league configured — the opposite failure to the one being fixed.
    expect(args.where).toEqual({ status: 'scheduled', scheduledProcessAt: { lte: NOW } })
    expect(args.orderBy).toEqual({ scheduledProcessAt: 'asc' })
    expect(args.take).toBe(DEFAULT_SCHEDULED_TRADE_LIMIT)
  })

  it('attributes processing to whoever scheduled the trade, not a synthetic system id', async () => {
    // `actorUserId` is not decorative: `assertRosterTransactionsAllowed` uses it for the
    // commissioner bypass on an illegal roster, so inventing an id silently changes that call.
    findManyMock.mockResolvedValue([{ id: 't-1', proposedByUserId: 'proposer-1' }])
    historyFindFirstMock.mockResolvedValue({ actorUserId: 'commish-9' })

    const { processDueScheduledTrades } = await import(
      '@/lib/automation/jobs/trades/processDueScheduledTrades'
    )
    const result = await processDueScheduledTrades({ now: NOW })

    expect(historyFindFirstMock.mock.calls[0][0].where).toEqual({ tradeId: 't-1', toStatus: 'scheduled' })
    expect(finalizeMock).toHaveBeenCalledWith({ tradeId: 't-1', actorUserId: 'commish-9' })
    expect(result).toEqual({ due: 1, processed: 1, failures: [] })
  })

  it('falls back to the proposer when no scheduling history row survives', async () => {
    findManyMock.mockResolvedValue([{ id: 't-2', proposedByUserId: 'proposer-2' }])
    historyFindFirstMock.mockResolvedValue(null)

    const { processDueScheduledTrades } = await import(
      '@/lib/automation/jobs/trades/processDueScheduledTrades'
    )
    await processDueScheduledTrades({ now: NOW })

    expect(finalizeMock).toHaveBeenCalledWith({ tradeId: 't-2', actorUserId: 'proposer-2' })
  })

  it('keeps sweeping past a trade that throws, and records why it stuck', async () => {
    // 🛑 A BATCH THAT ABORTS ON THE FIRST BAD ROW IS A BACKLOG THAT NEVER DRAINS. One league with
    // an illegal roster would hold up every other league's delayed trades indefinitely.
    findManyMock.mockResolvedValue([
      { id: 't-bad', proposedByUserId: 'u-1' },
      { id: 't-good', proposedByUserId: 'u-2' },
    ])
    finalizeMock
      .mockRejectedValueOnce(new Error('Your roster must be legal before this action.'))
      .mockResolvedValueOnce(undefined)

    const { processDueScheduledTrades } = await import(
      '@/lib/automation/jobs/trades/processDueScheduledTrades'
    )
    const result = await processDueScheduledTrades({ now: NOW })

    expect(result.due).toBe(2)
    expect(result.processed).toBe(1)
    expect(result.failures).toEqual([
      { tradeId: 't-bad', error: 'Your roster must be legal before this action.' },
    ])
    expect(finalizeMock).toHaveBeenCalledWith({ tradeId: 't-good', actorUserId: 'u-2' })

    // Without this row the trade retries every 30 minutes forever with nothing but a log line.
    expect(appendProcessingEventMock).toHaveBeenCalledTimes(1)
    expect(appendProcessingEventMock.mock.calls[0][0].tradeId).toBe('t-bad')
    expect(appendProcessingEventMock.mock.calls[0][0].eventType).toBe('trade_schedule_processing_failed')
  })

  it('survives an audit-write failure rather than losing the rest of the batch', async () => {
    findManyMock.mockResolvedValue([
      { id: 't-bad', proposedByUserId: 'u-1' },
      { id: 't-good', proposedByUserId: 'u-2' },
    ])
    finalizeMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined)
    appendProcessingEventMock.mockRejectedValueOnce(new Error('audit table unavailable'))

    const { processDueScheduledTrades } = await import(
      '@/lib/automation/jobs/trades/processDueScheduledTrades'
    )
    const result = await processDueScheduledTrades({ now: NOW })

    expect(result.processed).toBe(1)
    expect(result.failures).toHaveLength(1)
  })

  it('does nothing, and reports nothing, when no trade is due', async () => {
    const { processDueScheduledTrades } = await import(
      '@/lib/automation/jobs/trades/processDueScheduledTrades'
    )
    const result = await processDueScheduledTrades({ now: NOW })

    expect(result).toEqual({ due: 0, processed: 0, failures: [] })
    expect(finalizeMock).not.toHaveBeenCalled()
  })
})

/**
 * 🛑 THE HALF THAT IS EASY TO SKIP. `CLAUDE.md` records `ingestCFBDStats` existing for months
 * with no scheduled caller while the surface reading its output looked perfectly healthy. A
 * processor nobody invokes leaves delayed trades exactly as stuck as they were, and every unit
 * test above still passes.
 *
 * These read the repo's own files rather than mocking anything, because the claim is about
 * wiring, and wiring is not observable from inside a mocked module graph.
 */
describe('the processor has a scheduled caller', () => {
  const repoRoot = join(__dirname, '..', '..')
  const HOST_ROUTE = 'app/api/cron/trade-grade-notify/route.ts'
  const HOST_PATH = '/api/cron/trade-grade-notify'

  it('is invoked by the host cron route, not merely imported by it', () => {
    // ⚠ `toContain('processDueScheduledTrades')` was the first version of this, and it stayed
    // GREEN with the call deleted — the import line alone satisfied it. An identifier appearing
    // in a file is not evidence that anything calls it.
    const route = readFileSync(join(repoRoot, HOST_ROUTE), 'utf8')
    expect(route).toContain('processDueScheduledTrades()')
  })

  it('runs the sweep only on the authenticated cron path, never on the manual one', () => {
    // The manual branch is reachable by any signed-in league member. Executing every league's
    // due trades off someone opening their own trade page is not a sweep, it is a side effect.
    const route = readFileSync(join(repoRoot, HOST_ROUTE), 'utf8')
    const cronBranch = route.indexOf('if (isCron)')
    // ⚠ NOT `indexOf('getServerSession')` — that matches the IMPORT on line 2, so the assertion
    // compared against offset 65 and failed on correct code. Anchor on the manual branch's own
    // statement instead. A marker that also appears in an import is not a marker.
    const manualBranch = route.indexOf('const session = (await getServerSession')
    const sweepCall = route.indexOf('processDueScheduledTrades()')
    expect(cronBranch).toBeGreaterThan(-1)
    expect(manualBranch).toBeGreaterThan(cronBranch)
    expect(sweepCall).toBeGreaterThan(cronBranch)
    expect(sweepCall).toBeLessThan(manualBranch)
  })

  it('cannot take its host down: the sweep is wrapped in its own try/catch', () => {
    const route = readFileSync(join(repoRoot, HOST_ROUTE), 'utf8')
    const sweepCall = route.indexOf('processDueScheduledTrades()')
    const tryBefore = route.lastIndexOf('try {', sweepCall)
    const catchAfter = route.indexOf('} catch', sweepCall)
    expect(tryBefore).toBeGreaterThan(-1)
    expect(catchAfter).toBeGreaterThan(sweepCall)
  })

  it('that host route is actually scheduled in cron-schedule.json', () => {
    // ⚠ A route that exists but is not declared fires never. This is the check that separates
    // "the code is there" from "the job runs".
    const schedule = JSON.parse(readFileSync(join(repoRoot, 'cron-schedule.json'), 'utf8')) as {
      crons: { path: string; schedule: string }[]
    }
    const entry = schedule.crons.find((c) => c.path.split('?')[0] === HOST_PATH)
    expect(entry, `${HOST_PATH} is not declared in cron-schedule.json`).toBeDefined()
    expect(entry!.schedule).toBeTruthy()
  })

  it('the schedule assertion can fail (a path that is not declared is reported as absent)', () => {
    // Positive control for the test above: without it, a typo in HOST_PATH would make that
    // assertion pass against nothing, which is the failure mode this file is most exposed to.
    const schedule = JSON.parse(readFileSync(join(repoRoot, 'cron-schedule.json'), 'utf8')) as {
      crons: { path: string; schedule: string }[]
    }
    expect(schedule.crons.find((c) => c.path.split('?')[0] === '/api/cron/not-a-real-job')).toBeUndefined()
  })
})
