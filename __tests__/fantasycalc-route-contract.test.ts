import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

const getCanonicalValuationSnapshotMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/player-valuations/canonicalPlayerValuations', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/player-valuations/canonicalPlayerValuations')>(),
  getCanonicalValuationSnapshot: getCanonicalValuationSnapshotMock,
}))

const samplePlayers = [
  {
    player: {
      id: 1,
      name: 'Justin Jefferson',
      mflId: 'm1',
      sleeperId: '111',
      position: 'WR',
      maybeBirthday: null,
      maybeHeight: null,
      maybeWeight: null,
      maybeCollege: null,
      maybeTeam: 'MIN',
      maybeAge: 26,
      maybeYoe: 4,
      espnId: null,
      fleaflickerId: null,
    },
    value: 9500,
    overallRank: 1,
    positionRank: 1,
    trend30Day: 120,
    redraftDynastyValueDifference: 0,
    redraftDynastyValuePercDifference: 0,
    redraftValue: 9000,
    combinedValue: 9400,
    maybeMovingStandardDeviation: null,
    maybeMovingStandardDeviationPerc: null,
    maybeMovingStandardDeviationAdjusted: null,
    displayTrend: true,
    maybeOwner: null,
    starter: true,
    maybeTier: 1,
    maybeAdp: 1,
    maybeTradeFrequency: null,
  },
  {
    player: {
      id: 2,
      name: 'Ja\'Marr Chase',
      mflId: 'm2',
      sleeperId: '222',
      position: 'WR',
      maybeBirthday: null,
      maybeHeight: null,
      maybeWeight: null,
      maybeCollege: null,
      maybeTeam: 'CIN',
      maybeAge: 26,
      maybeYoe: 4,
      espnId: null,
      fleaflickerId: null,
    },
    value: 9100,
    overallRank: 2,
    positionRank: 2,
    trend30Day: 90,
    redraftDynastyValueDifference: 0,
    redraftDynastyValuePercDifference: 0,
    redraftValue: 8800,
    combinedValue: 9000,
    maybeMovingStandardDeviation: null,
    maybeMovingStandardDeviationPerc: null,
    maybeMovingStandardDeviationAdjusted: null,
    displayTrend: true,
    maybeOwner: null,
    starter: true,
    maybeTier: 1,
    maybeAdp: 2,
    maybeTradeFrequency: null,
  },
]

describe('FantasyCalc route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns values payload from DB cache', async () => {
    getCanonicalValuationSnapshotMock.mockResolvedValueOnce({
      players: samplePlayers,
      source: 'canonical_provider',
      stale: false,
      sourceTimestampIso: '2026-04-08T00:00:00.000Z',
      fallbackUsed: false,
      cacheUsed: false,
    })

    const { GET } = await import('@/app/api/fantasycalc/route')
    const req = createMockNextRequest('http://localhost/api/fantasycalc?action=values&limit=5')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('canonical_provider')
    expect(body.stale).toBe(false)
    expect(body.players).toHaveLength(2)
    expect(body.players[0].player.name).toBe('Justin Jefferson')
  })

  it('returns stale metadata when cache is stale fallback', async () => {
    getCanonicalValuationSnapshotMock.mockResolvedValueOnce({
      players: samplePlayers,
      source: 'canonical_cache',
      stale: true,
      sourceTimestampIso: '2026-04-07T00:00:00.000Z',
      fallbackUsed: true,
      cacheUsed: true,
    })

    const { GET } = await import('@/app/api/fantasycalc/route')
    const req = createMockNextRequest('http://localhost/api/fantasycalc?action=top&limit=1')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('canonical_cache')
    expect(body.stale).toBe(true)
    expect(body.players).toHaveLength(1)
  })

  it('returns 503 when cache is empty', async () => {
    getCanonicalValuationSnapshotMock.mockResolvedValueOnce({
      players: [],
      source: 'unavailable',
      stale: false,
      sourceTimestampIso: null,
      fallbackUsed: false,
      cacheUsed: false,
    })

    const { GET } = await import('@/app/api/fantasycalc/route')
    const req = createMockNextRequest('http://localhost/api/fantasycalc?action=values')
    const res = await GET(req)

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toContain('unavailable')
  })

  it('compares trade values from DB-backed data', async () => {
    getCanonicalValuationSnapshotMock.mockResolvedValueOnce({
      players: samplePlayers,
      source: 'canonical_provider',
      stale: false,
      sourceTimestampIso: '2026-04-08T00:00:00.000Z',
      fallbackUsed: false,
      cacheUsed: false,
    })

    const { POST } = await import('@/app/api/fantasycalc/route')
    const req = createMockNextRequest('http://localhost/api/fantasycalc', {
      method: 'POST',
      body: {
        sideA: ['Justin Jefferson'],
        sideB: ['Ja\'Marr Chase'],
      },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sideATotal).toBe(9500)
    expect(body.sideBTotal).toBe(9100)
    expect(body.winner).toBe('EVEN')
    expect(body.source).toBe('canonical_provider')
  })
})
