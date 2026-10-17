// @vitest-environment node
/**
 * 🛑 A player id containing ':' is recomputed as ITSELF, not as player "name" in sport "<First Last>".
 *
 * `recordTrendSignalsAndUpdate` deduped on `${playerId}:${sport}` and split the key back on ':'. A native
 * draft's ids are `name:Jahmyr Gibbs:RB:DET`, so the recompute ran for player "name", sport "Jahmyr
 * Gibbs" — 14 junk player_meta_trends rows in production, and no trend at all for the 41 real players.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ upserts: [] as Array<{ playerId: string; sport: string }> }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trendSignalEvent: { create: vi.fn(async () => ({})) },
    playerMetaTrend: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async ({ create }: { create: { playerId: string; sport: string } }) => {
        h.upserts.push({ playerId: create.playerId, sport: create.sport })
        return {}
      }),
    },
  },
}))
vi.mock('@/lib/player-trend/TrendSignalAggregator', () => ({
  aggregateSignalsForPlayer: vi.fn(async () => ({
    signals: { addRate: 0, dropRate: 0, tradeInterest: 0, draftFrequency: 1, lineupStartRate: 0, injuryImpact: 0 },
    eventCount: 1,
  })),
  getPreviousTrendScore: vi.fn(async () => null),
  getSportTrendBaselineScore: vi.fn(async () => 50),
}))

import { recordTrendSignalsAndUpdate } from '@/lib/player-trend/PlayerTrendUpdater'

beforeEach(() => {
  h.upserts = []
})

describe('recordTrendSignalsAndUpdate — the (playerId, sport) pair survives the dedupe', () => {
  it('recomputes a native `name:` id under its own id and sport', async () => {
    await recordTrendSignalsAndUpdate([
      { playerId: 'name:Jahmyr Gibbs:RB:DET', sport: 'NFL', signalType: 'draft_pick' },
      { playerId: 'name:Jahmyr Gibbs:RB:DET', sport: 'NFL', signalType: 'ai_recommendation' },
      { playerId: '9228', sport: 'NFL', signalType: 'draft_pick' },
    ])
    expect(h.upserts).toEqual([
      { playerId: 'name:Jahmyr Gibbs:RB:DET', sport: 'NFL' },
      { playerId: '9228', sport: 'NFL' },
    ])
  })
})
