import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $transaction: vi.fn(async (ops: unknown[]) => ops),
  tradeAgentSuggestion: { findMany: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn((a: unknown) => ({ op: 'delete', a })), createMany: vi.fn((a: unknown) => ({ op: 'create', a })) },
}))
const agent = vi.hoisted(() => ({ runTradeAgentForLeague: vi.fn(), tradeAgentLeagueIds: vi.fn() }))
const telemetry = vi.hoisted(() => ({ recordSyncJobRun: vi.fn(async () => undefined) }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/decision-os/trade/tradeAgent', () => agent)
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => telemetry)

import {
  readTradeAgentSuggestions,
  resetTradeAgentTableCache,
  saveTradeAgentSuggestions,
  tradeAgentTableReady,
} from '@/lib/decision-os/trade/tradeAgentStore'
import { runTradeAgentPass } from '@/lib/decision-os/trade/tradeAgentPass'

const NIGHT = new Date('2026-09-28T05:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  resetTradeAgentTableCache()
  db.$queryRaw.mockResolvedValue([{ n: 1 }])
  db.tradeAgentSuggestion.findMany.mockResolvedValue([])
  agent.tradeAgentLeagueIds.mockResolvedValue(['L1', 'L2', 'L3'])
  agent.runTradeAgentForLeague.mockResolvedValue({ leagueId: 'x', managers: 1, graded: 4, saved: 2, partial: false })
})

describe('tradeAgentTableReady — nothing runs before the migration', () => {
  it('reads not-ready while the table is missing, re-checks after ten minutes, and never throws', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ n: 0 }])
    expect(await tradeAgentTableReady({ now: () => 0 })).toBe(false)
    expect(await tradeAgentTableReady({ now: () => 60_000 })).toBe(false)
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)
    db.$queryRaw.mockRejectedValueOnce(new Error('down'))
    expect(await tradeAgentTableReady({ now: () => 11 * 60_000 })).toBe(false)
    expect(await tradeAgentTableReady({ now: () => 22 * 60_000 })).toBe(true)
  })

  it('the Trades screen reads nothing — no query against the missing table — until it exists', async () => {
    db.$queryRaw.mockResolvedValue([{ n: 0 }])
    expect(await readTradeAgentSuggestions('L1', 'u1')).toEqual([])
    expect(db.tradeAgentSuggestion.findFirst).not.toHaveBeenCalled()
  })
})

describe('saveTradeAgentSuggestions', () => {
  it('replaces the manager’s whole list in the league — tonight’s, even when empty', async () => {
    await saveTradeAgentSuggestions({ leagueId: 'L1', userId: 'u1', rosterId: 'r1', runDate: '2026-09-28', suggestions: [] })
    expect(db.tradeAgentSuggestion.deleteMany).toHaveBeenCalledWith({ where: { leagueId: 'L1', userId: 'u1' } })
    expect(db.tradeAgentSuggestion.createMany).toHaveBeenCalledWith({ data: [], skipDuplicates: true })
  })
})

describe('runTradeAgentPass', () => {
  it('does nothing outside the nightly window, or before the migration', async () => {
    expect(await runTradeAgentPass({ now: new Date('2026-09-28T15:00:00Z'), budgetMs: 200_000 })).toMatchObject({ ran: false, reason: /window/ })
    db.$queryRaw.mockResolvedValue([{ n: 0 }])
    expect(await runTradeAgentPass({ now: NIGHT, budgetMs: 200_000 })).toMatchObject({ ran: false, reason: expect.stringMatching(/migration is not applied/) })
    expect(agent.runTradeAgentForLeague).not.toHaveBeenCalled()
  })

  it('visits only the leagues not done tonight, isolates a failing league, and records its run', async () => {
    db.tradeAgentSuggestion.findMany.mockResolvedValue([{ leagueId: 'L2' }])
    agent.runTradeAgentForLeague.mockImplementation(async (id: string) => {
      if (id === 'L3') throw new Error('boom')
      return { leagueId: id, managers: 1, graded: 4, saved: 2, partial: false }
    })
    const out = await runTradeAgentPass({ now: NIGHT, budgetMs: 200_000 })
    expect(out).toMatchObject({ ran: true, runDate: '2026-09-28', eligible: 3, alreadyDone: 1, visited: 2, failed: 1, saved: 2 })
    expect(agent.runTradeAgentForLeague.mock.calls.map((c) => c[0]).sort()).toEqual(['L1', 'L3'])
    expect(telemetry.recordSyncJobRun).toHaveBeenCalledWith(
      { jobName: 'cron-trade-agent', trigger: 'cron' },
      expect.objectContaining({ status: 'partial', errors: [expect.stringContaining('L3: boom')] }),
      expect.any(Number),
    )
  })

  it('a pass with almost no time left does not start', async () => {
    expect(await runTradeAgentPass({ now: NIGHT, budgetMs: 3_000 })).toMatchObject({ ran: false })
    expect(agent.tradeAgentLeagueIds).not.toHaveBeenCalled()
  })
})
