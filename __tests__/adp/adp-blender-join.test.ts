import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  adpDataRecord: { findMany: vi.fn() },
  draftSession: { findMany: vi.fn() },
  draftPick: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const ai = vi.hoisted(() => ({ getAiAdpForLeague: vi.fn() }))
vi.mock('@/lib/ai-adp-engine', () => ai)

import { blendAdpRankings } from '@/lib/workers/adp-blender'

beforeEach(() => {
  db.league.findUnique.mockResolvedValue({ id: 'L1', sport: 'NFL', isDynasty: false, settings: {} })
  // Provider rows are keyed by the slug id the ADP writer produces.
  db.adpDataRecord.findMany.mockResolvedValue([
    { playerId: 'NFL:brian-thomas:WR:JAX', playerName: 'Brian Thomas Jr.', position: 'WR', team: 'JAX', adp: 20, source: 'sleeper' },
  ])
  db.draftSession.findMany.mockResolvedValue([{ id: 's1', league: { isDynasty: false, settings: {} } }])
  // Our own draft picks carry the Sleeper id.
  db.draftPick.findMany.mockResolvedValue([
    { playerId: '9493', playerName: 'Brian Thomas Jr.', position: 'WR', team: 'JAX', overall: 30 },
  ])
  ai.getAiAdpForLeague.mockResolvedValue({ entries: [{ playerName: 'Brian Thomas', position: 'WR', team: 'JAX', adp: 26, sampleSize: 40 }] })
})

describe('blendAdpRankings — one player from three sources is ONE blended row', () => {
  it('joins provider, app and ai rows for the same player despite different id spaces', async () => {
    const rows = await blendAdpRankings('L1')
    const thomas = rows.filter((r) => /brian thomas/i.test(r.playerName))
    expect(thomas).toHaveLength(1)
    expect(thomas[0].sources?.api).toBe(20)
    expect(thomas[0].sources?.global_app).toBe(30)
    expect(thomas[0].sources?.ai).toBe(26)
  })
})
