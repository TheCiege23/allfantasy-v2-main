import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readRosters: vi.fn(),
  readCache: vi.fn(),
  writeCache: vi.fn(),
  lock: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/devy/ncaabRosterPool', () => ({ currentNcaabRosterEvidence: mocks.readRosters }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: { findUnique: mocks.readCache },
    $transaction: mocks.transaction,
  },
}))

import { importNbaProspectRanks, readNbaProspectRanks } from '@/lib/adp/nbaProspectRanks'

const now = new Date('2026-11-10T17:00:00Z')
const expiresAt = new Date('2026-12-09T17:00:00Z')
const players = Array.from({ length: 5 }, (_, i) => ({ playerId: 'espn:ncaab:' + (100 + i), name: 'Player ' + i, rank: i + 1 }))
const board = { source: 'Original draft projections', publishedAt: '2026-11-09T17:00:00Z', draftYear: 2027, players }
const production = { ...board, source: 'AllFantasy provisional NCAA production board', rankBasis: 'college_production' }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.readRosters.mockResolvedValue({ athletes: players.map((p) => ({ id: p.playerId, name: p.name })) })
  mocks.readCache.mockResolvedValue(null)
  mocks.transaction.mockImplementation(async (apply) => apply({
    $executeRaw: mocks.lock,
    sportsDataCache: { findUnique: mocks.readCache, upsert: mocks.writeCache },
  }))
})

describe('NBA prospect board publication', () => {
  it('validates production ranks offline and refuses to publish them even if relabeled', async () => {
    expect(await importNbaProspectRanks(production, false, now)).toEqual({
      draftYear: 2027, matched: 5, unmatched: 0, pricingReady: false, applied: false,
    })
    await expect(importNbaProspectRanks(production, true, now)).rejects.toThrow('Live NBA pricing requires')
    await expect(importNbaProspectRanks({ ...production, rankBasis: 'nba_draft_projection' }, true, now))
      .rejects.toThrow('Live NBA pricing requires')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('uses a marked draft-order board after publishing and retains its provenance', async () => {
    const ranked = { ...board, rankBasis: 'nba_draft_projection' }
    expect(await importNbaProspectRanks(ranked, false, now)).toMatchObject({ matched: 5, pricingReady: true, applied: false })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(await importNbaProspectRanks(ranked, true, now)).toMatchObject({ matched: 5, pricingReady: true, applied: true })
    expect(mocks.writeCache).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ data: ranked, expiresAt }) }))
    mocks.readCache.mockResolvedValue({ data: ranked, expiresAt })
    expect((await readNbaProspectRanks(2027, now)).get(players[0]!.playerId)).toMatchObject({ rank: 1, draftYear: 2027 })
  })

  it('requires a basis for live pricing and withholds legacy or college-production cache rows', async () => {
    expect(await importNbaProspectRanks(board, false, now)).toMatchObject({ matched: 5, pricingReady: false })
    await expect(importNbaProspectRanks(board, true, now)).rejects.toThrow('Live NBA pricing requires')
    for (const data of [board, production]) {
      mocks.readCache.mockResolvedValue({ data, expiresAt })
      expect((await readNbaProspectRanks(2027, now)).size).toBe(0)
    }
  })
})
