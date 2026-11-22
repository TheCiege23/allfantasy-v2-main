import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Trade learning (owner's call, 2026-11-22): the census found FAAB on 0% of Sleeper trades. Sleeper states the FAAB a
 * trade moves (`waiver_budget`: sender, receiver, amount), and neither trade writer carried it to `LeagueTrade`. Both
 * do now, through one normalizer — and an unstated budget stays NULL, never 0.
 */

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ upserts: [] as Array<{ create: Record<string, unknown>; update: Record<string, unknown> }>, transactions: [] as unknown[] }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTradeHistory: { upsert: vi.fn(async (a: { create: { sleeperUsername: string } }) => ({ id: `hist-${a.create.sleeperUsername}` })) },
    leagueTrade: {
      upsert: vi.fn(async (a: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        h.upserts.push(a)
        return a.create
      }),
    },
  },
}))
vi.mock('@/lib/sleeper-client', () => ({
  getLeagueTransactions: vi.fn(async (_id: string, week: number) => (week === 1 ? h.transactions : [])),
  getLeagueHistory: vi.fn(), getLeagueRosters: vi.fn(), getPlayoffBracket: vi.fn(),
}))

const { sleeperTradeWaiverBudget } = await import('@/lib/league-import/adapters/sleeper/types')
const { SleeperHistoryMapper } = await import('@/lib/league-import/adapters/sleeper/SleeperHistoryMapper')
const { fetchSleeperTradesForSeason } = await import('@/lib/dynasty-import/sleeper-historical')
const { persistTradesForSeason } = await import('@/lib/dynasty-import/normalize-historical')

// Roster 3 sends $25 of FAAB to roster 7 along with a player; roster 7 sends a player back.
const trade = {
  transaction_id: 'tx-1', type: 'trade', status: 'complete', created: Date.UTC(2026, 10, 18), status_updated: Date.UTC(2026, 10, 18, 1),
  roster_ids: [3, 7], adds: { p1: 7, p2: 3 }, drops: { p1: 3, p2: 7 }, draft_picks: [], week: 11,
  waiver_budget: [{ sender: 3, receiver: 7, amount: 25 }],
}

beforeEach(() => {
  h.upserts.length = 0
  h.transactions = []
})

describe('one normalizer for what Sleeper states', () => {
  it('normalizes the transfers; an empty list is "none moved"; no list is "never read"; a malformed entry is unreadable', () => {
    expect(sleeperTradeWaiverBudget([{ sender: 3, receiver: 7, amount: 25 }])).toEqual([{ sender: '3', receiver: '7', amount: 25 }])
    expect(sleeperTradeWaiverBudget([])).toEqual([])
    expect(sleeperTradeWaiverBudget(undefined)).toBeNull()
    expect(sleeperTradeWaiverBudget([{ sender: 3, amount: 25 }])).toBeNull()
    expect(sleeperTradeWaiverBudget([{ sender: 3, receiver: 7, amount: 'lots' }])).toBeNull()
  })
})

describe('both trade writers carry it to LeagueTrade', () => {
  it('the live sync: the mapper keeps a trade\'s FAAB, and never puts one on a waiver claim', () => {
    const mapped = SleeperHistoryMapper.map({ transactions: [trade, { ...trade, transaction_id: 'w-1', type: 'waiver' }] } as never)
    expect(mapped.transactions.find((t) => t.source_transaction_id === 'tx-1')!.waiver_budget).toEqual([{ sender: '3', receiver: '7', amount: 25 }])
    expect(mapped.transactions.find((t) => t.source_transaction_id === 'w-1')!.waiver_budget).toBeUndefined()
  })

  it('the live sync writes it: a mapped trade reaches LeagueTrade with each side\'s FAAB', async () => {
    const { persistLiveTrades } = await import('@/lib/import-os/collector/persistLiveTrades')
    const normalized = {
      ...SleeperHistoryMapper.map({ transactions: [trade] } as never),
      source: { source_provider: 'sleeper', source_league_id: 'sl-1' },
      league: { sport: 'NFL' },
      rosters: [
        { source_team_id: '3', source_manager_id: 'mgr-3', player_ids: [] },
        { source_team_id: '7', source_manager_id: 'mgr-7', player_ids: [] },
      ],
    }
    await persistLiveTrades({ platformLeagueId: 'sl-1', season: 2026, normalized: normalized as never })
    const sent = h.upserts.find((u) => u.create.transactionId === 'tx-1' && u.create.historyId === 'hist-mgr-3')!.create
    expect(sent).toMatchObject({ budgetGiven: 25, budgetReceived: 0 })
  })

  it('the history backfill reads it from each week\'s transactions', async () => {
    h.transactions = [trade, { ...trade, transaction_id: 'tx-unstated', waiver_budget: undefined }]
    const facts = await fetchSleeperTradesForSeason('sl-1', 2026, 1)
    expect(facts.find((f) => f.transactionId === 'tx-1')!.waiverBudget).toEqual([{ sender: '3', receiver: '7', amount: 25 }])
    expect(facts.find((f) => f.transactionId === 'tx-unstated')!.waiverBudget).toBeUndefined()
  })

  it('stored: each side\'s FAAB given and received; an unstated budget leaves the columns NULL', async () => {
    h.transactions = [trade, { ...trade, transaction_id: 'tx-unstated', waiver_budget: undefined }]
    const facts = await fetchSleeperTradesForSeason('sl-1', 2026, 1)
    await persistTradesForSeason('sl-1', 2026, facts, new Map([['3', 'mgr-3'], ['7', 'mgr-7']]))
    const row = (tx: string, hist: string) => h.upserts.find((u) => u.create.transactionId === tx && u.create.historyId === hist)!.create
    expect(row('tx-1', 'hist-mgr-3')).toMatchObject({ budgetGiven: 25, budgetReceived: 0 })
    expect(row('tx-1', 'hist-mgr-7')).toMatchObject({ budgetGiven: 0, budgetReceived: 25 })
    expect(row('tx-unstated', 'hist-mgr-3')).not.toHaveProperty('budgetGiven')
  })
})
