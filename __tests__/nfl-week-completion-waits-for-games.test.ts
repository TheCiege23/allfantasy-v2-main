import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * 🛑 THE PRODUCTION FAILURE THIS PINS (measured 2026-09-23): 2026 NFL week 1 was imported the
 * morning of opening night and week 2 the morning after Thursday Night Football. Each was ledgered
 * `completed` (147 / 139 rows, against ~2,250 a week in 2025), and a completed week is never
 * fetched again — so no Sunday or Monday game was ever imported, and Chimmy could not answer
 * "how many yards did X have last week".
 */

const h = vi.hoisted(() => ({
  ledgerCompleted: [] as Array<{ weekOrRound: number; completedAt: Date | null }>,
  ledgerAny: [] as Array<{ weekOrRound: number }>,
  stats: [] as Array<{ weekOrRound: number; _count: { _all: number } }>,
  facts: [] as Array<{ weekOrRound: number; _count: { _all: number } }>,
  games: [] as Array<{ week: number | null; startTime: Date | null; seasonType: string | null }>,
  gamesThrow: false,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    statIngestionJob: {
      findMany: async (args: { where: { status?: string } }) =>
        args.where.status === 'completed' ? h.ledgerCompleted : h.ledgerAny,
    },
    playerGameStat: { groupBy: async () => h.stats },
    playerGameFact: { groupBy: async () => h.facts },
    sportsGame: {
      findMany: async () => {
        if (h.gamesThrow) throw new Error('db down')
        return h.games
      },
    },
  },
}))
vi.mock('@/lib/schedule-stats', () => ({ ingestSportStats: vi.fn() }))
vi.mock('@/lib/data-warehouse/HistoricalFactGenerator', () => ({ generateGameFactsFromExistingStats: vi.fn() }))

import { findWeeksNeedingWork, NFL_WEEK_SETTLE_MS } from '@/lib/player-game-stats/importPlayerGameStats'

/* 2026 week 2 as it actually ran: TNF Thu 09-17, last kickoff MNF Tue 00:15Z 09-22. */
const WEEK2_TNF = new Date('2026-09-18T00:15:00Z')
const WEEK2_LAST = new Date('2026-09-22T00:15:00Z')
const STAMPED_AFTER_TNF = new Date('2026-09-18T10:55:12Z')

function week2(games = true) {
  h.games = games
    ? [
        { week: 2, startTime: WEEK2_TNF, seasonType: 'regular' },
        { week: 2, startTime: WEEK2_LAST, seasonType: 'regular' },
      ]
    : []
}

beforeEach(() => {
  h.ledgerCompleted = []
  h.ledgerAny = []
  h.stats = []
  h.facts = []
  h.games = []
  h.gamesThrow = false
})

describe('findWeeksNeedingWork — a week is complete only once its games are', () => {
  it('REGRESSION: a week stamped `completed` after Thursday night is fetched again once it settles', async () => {
    week2()
    h.ledgerCompleted = [{ weekOrRound: 2, completedAt: STAMPED_AFTER_TNF }]
    h.ledgerAny = [{ weekOrRound: 2 }]
    h.stats = [{ weekOrRound: 2, _count: { _all: 139 } }]
    h.facts = [{ weekOrRound: 2, _count: { _all: 139 } }]

    const plan = await findWeeksNeedingWork(2026, { now: new Date('2026-09-23T18:00:00Z') })

    expect(plan.completed).not.toContain(2)
    expect(plan.missing).toContain(2)
  })

  it('keeps fetching a week while it is still being played, even when its counts reconcile', async () => {
    week2()
    h.ledgerCompleted = [{ weekOrRound: 2, completedAt: STAMPED_AFTER_TNF }]
    h.ledgerAny = [{ weekOrRound: 2 }]
    h.stats = [{ weekOrRound: 2, _count: { _all: 139 } }]
    h.facts = [{ weekOrRound: 2, _count: { _all: 139 } }]

    const plan = await findWeeksNeedingWork(2026, { now: new Date('2026-09-20T12:00:00Z') })

    expect(plan.missing).toContain(2)
  })

  it('completes a week whose ledger row was written after it settled', async () => {
    week2()
    const afterSettle = new Date(WEEK2_LAST.getTime() + NFL_WEEK_SETTLE_MS + 60_000)
    h.ledgerCompleted = [
      { weekOrRound: 2, completedAt: STAMPED_AFTER_TNF },
      { weekOrRound: 2, completedAt: afterSettle },
    ]
    h.ledgerAny = [{ weekOrRound: 2 }, { weekOrRound: 2 }]
    h.stats = [{ weekOrRound: 2, _count: { _all: 2240 } }]
    h.facts = [{ weekOrRound: 2, _count: { _all: 2240 } }]

    const plan = await findWeeksNeedingWork(2026, { now: new Date(afterSettle.getTime() + 60_000) })

    expect(plan.completed).toContain(2)
    expect(plan.missing).not.toContain(2)
  })

  it('still grandfathers a settled week ingested before the ledger existed (no ledger row at all)', async () => {
    week2()
    h.stats = [{ weekOrRound: 2, _count: { _all: 2240 } }]
    h.facts = [{ weekOrRound: 2, _count: { _all: 2240 } }]

    const plan = await findWeeksNeedingWork(2026, { now: new Date('2026-10-30T00:00:00Z') })

    expect(plan.completed).toContain(2)
  })

  it('does not grandfather a week that has any ledger row — that is how the bad stamps are undone', async () => {
    week2()
    h.ledgerAny = [{ weekOrRound: 2 }]
    h.ledgerCompleted = [{ weekOrRound: 2, completedAt: STAMPED_AFTER_TNF }]
    h.stats = [{ weekOrRound: 2, _count: { _all: 139 } }]
    h.facts = [{ weekOrRound: 2, _count: { _all: 139 } }]

    const plan = await findWeeksNeedingWork(2026, { now: new Date('2026-10-30T00:00:00Z') })

    expect(plan.completed).not.toContain(2)
  })

  it('still routes a stats-without-facts week to the cheap facts repair', async () => {
    week2()
    h.stats = [{ weekOrRound: 2, _count: { _all: 2240 } }]
    h.facts = []

    const plan = await findWeeksNeedingWork(2026, { now: new Date('2026-10-30T00:00:00Z') })

    expect(plan.partial).toEqual([2])
  })

  it('ignores preseason rows that share the week number', async () => {
    h.games = [
      { week: 2, startTime: new Date('2026-08-15T00:00:00Z'), seasonType: 'preseason' },
      { week: 2, startTime: WEEK2_LAST, seasonType: 'Regular Season' },
    ]
    h.ledgerAny = [{ weekOrRound: 2 }]
    // Stamped after PRESEASON week 2 settled, but long before regular week 2 did.
    h.ledgerCompleted = [{ weekOrRound: 2, completedAt: new Date('2026-08-20T00:00:00Z') }]
    h.stats = [{ weekOrRound: 2, _count: { _all: 139 } }]
    h.facts = [{ weekOrRound: 2, _count: { _all: 139 } }]

    const plan = await findWeeksNeedingWork(2026, { now: new Date('2026-09-25T00:00:00Z') })

    expect(plan.completed).not.toContain(2)
  })

  it('falls back to the old rules when the schedule cannot be read', async () => {
    h.gamesThrow = true
    h.ledgerCompleted = [{ weekOrRound: 2, completedAt: STAMPED_AFTER_TNF }]
    h.ledgerAny = [{ weekOrRound: 2 }]
    h.stats = [{ weekOrRound: 2, _count: { _all: 139 } }]
    h.facts = [{ weekOrRound: 2, _count: { _all: 139 } }]

    const plan = await findWeeksNeedingWork(2026, { now: new Date('2026-09-23T18:00:00Z') })

    expect(plan.completed).toContain(2)
  })
})
