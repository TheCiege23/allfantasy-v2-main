/**
 * The offer ledger, written by the notify sweep the moment it sees a trade (trade system handoff,
 * Phase 2: "Store pending status and assets on the ledger").
 *
 * Measured 2026-09-25: 124 of 124 offers in eight days were first recorded already ACCEPTED, with a
 * null `payload` — only the ledger's own rotation wrote it, 15 leagues a run. These run the real
 * `persistProviderTradeOffers` against a Prisma double, so what reaches the table is what is asserted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  upsert: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    providerTradeOffer: { upsert: h.upsert, updateMany: h.updateMany },
    providerTradeOfferAsset: { deleteMany: h.deleteMany, createMany: h.createMany },
  },
}))

import { recordSweptTradesOnLedger } from '@/lib/provider-trades/syncProviderTradeOffers'
import { normalizeSleeperTradeOffer } from '@/lib/provider-trades/providerTradeOfferLedger'
import type { FeedTrade } from '@/lib/trade-intel/sleeperTradeSync'

const RAW = {
  transaction_id: 'T1',
  type: 'trade',
  status: 'pending',
  roster_ids: [2, 4],
  consenter_ids: [4],
  creator: 'sl-D',
  created: 1_790_000_000_000,
  leg: 3,
  adds: { p1: 2, p2: 4 },
  drops: { p1: 4, p2: 2 },
  draft_picks: [{ season: '2027', round: 1, roster_id: 4, previous_owner_id: 4, owner_id: 2 }],
  waiver_budget: [],
  settings: { expires_at: null },
}

const feedTrade = (withRaw: boolean, status: FeedTrade['status'] = 'pending'): FeedTrade => ({
  id: 'T1',
  status,
  rosterIds: [2, 4],
  creator: 'sl-D',
  createdMs: RAW.created,
  week: 3,
  tx: { adds: RAW.adds, drops: RAW.drops, draft_picks: RAW.draft_picks as never, waiver_budget: [] },
  ...(withRaw ? { raw: { ...RAW, status: status } } : {}),
})

const LEAGUES = [
  { id: 'af-A', sport: 'NFL', season: 2026 },
  { id: 'af-B', sport: 'NFL', season: 2026 },
]

beforeEach(() => {
  vi.clearAllMocks()
  h.upsert.mockImplementation(async (args: { where: { uniq_provider_trade_offer: { leagueId: string } } }) => ({
    id: `row-${args.where.uniq_provider_trade_offer.leagueId}`,
  }))
  h.updateMany.mockResolvedValue({ count: 0 })
  h.deleteMany.mockResolvedValue({ count: 0 })
  h.createMany.mockResolvedValue({ count: 0 })
})

describe('recordSweptTradesOnLedger', () => {
  it('records a new offer PENDING, first seen now, with its assets and the raw record — on every AF copy', async () => {
    const now = new Date('2026-09-26T04:00:00Z')
    const r = await recordSweptTradesOnLedger({ leagues: LEAGUES, trades: [feedTrade(true)], now })
    expect(r).toEqual({ offersWritten: 2, leaguesFailed: 0 })
    expect(h.upsert).toHaveBeenCalledTimes(2)
    const call = h.upsert.mock.calls[0][0] as { create: Record<string, unknown>; update: Record<string, unknown> }
    expect(call.create).toMatchObject({
      leagueId: 'af-A',
      provider: 'sleeper',
      providerTradeId: 'T1',
      status: 'pending',
      providerStatus: 'pending',
      weekOrPeriod: 3,
      consentedRosterIds: ['4'],
      firstSeenAt: now,
      lastSeenAt: now,
      payload: { ...RAW },
    })
    // firstSeenAt is create-only, so a later completion does not reset the offer's age.
    expect(call.update).not.toHaveProperty('firstSeenAt')
    expect(h.createMany.mock.calls[0][0].data.map((a: { assetType: string }) => a.assetType).sort()).toEqual(['pick', 'player', 'player'])
  })

  it('🛑 never retires anything — a sweep slice is not proof of absence', async () => {
    await recordSweptTradesOnLedger({ leagues: LEAGUES, trades: [feedTrade(true)] })
    expect(h.updateMany).not.toHaveBeenCalled()
  })

  it('a completion updates the same row to accepted', async () => {
    await recordSweptTradesOnLedger({ leagues: LEAGUES.slice(0, 1), trades: [feedTrade(true, 'complete')] })
    expect((h.upsert.mock.calls[0][0] as { update: { status: string } }).update.status).toBe('accepted')
  })

  it('a row with no raw record writes no payload rather than a reconstructed one', async () => {
    await recordSweptTradesOnLedger({ leagues: LEAGUES.slice(0, 1), trades: [feedTrade(false)] })
    const call = h.upsert.mock.calls[0][0] as { create: Record<string, unknown>; update: Record<string, unknown> }
    expect(call.create).not.toHaveProperty('payload')
    expect(call.update).not.toHaveProperty('payload')
    expect(call.create.status).toBe('pending')
  })

  it('one AF league failing does not stop the next, and it never throws', async () => {
    h.upsert.mockRejectedValueOnce(new Error('db')).mockResolvedValue({ id: 'row' })
    const r = await recordSweptTradesOnLedger({ leagues: LEAGUES, trades: [feedTrade(true)] })
    expect(r).toEqual({ offersWritten: 1, leaguesFailed: 1 })
  })

  it('nothing to record writes nothing', async () => {
    expect(await recordSweptTradesOnLedger({ leagues: LEAGUES, trades: [] })).toEqual({ offersWritten: 0, leaguesFailed: 0 })
    expect(h.upsert).not.toHaveBeenCalled()
  })
})

describe('normalizeSleeperTradeOffer keeps the raw record', () => {
  it('payload is the transaction as Sleeper sent it', () => {
    expect(normalizeSleeperTradeOffer(RAW, { week: 3 })?.payload).toBe(RAW)
  })
})
