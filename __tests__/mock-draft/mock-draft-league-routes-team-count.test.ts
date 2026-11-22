/**
 * The league-derived mock tools (pick path, board prediction, snipe radar, trade optimizer) draft
 * with the league's REAL size. They used `Math.max(leagueSize, teams, 12)`, so a 4-, 8- or 10-team
 * league was simulated as a 12-team draft, with user picks at overalls that league never has.
 * Each route is driven end to end with a stored league and a stubbed player pool.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ league: null as Record<string, unknown> | null }))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: vi.fn(async () => h.league) },
    leagueDraftCalibration: { findUnique: vi.fn(async () => null) },
    draftPredictionSnapshot: { create: vi.fn(async () => ({ id: 'snap' })) },
  },
}))

const POS = ['QB', 'RB', 'WR', 'TE']
const entries = Array.from({ length: 220 }, (_, i) => ({
  name: `Player ${i + 1}`,
  position: POS[i % 4]!,
  team: 'KC',
  adp: i + 1,
  adpFormatted: null,
  adpTrend: null,
  age: 25,
  value: 1000 - i,
  source: 'ffc' as const,
  ffcPlayerId: i + 1,
  timesDrafted: null,
  adpHigh: null,
  adpLow: null,
  adpStdev: null,
  bye: null,
}))
vi.mock('@/lib/adp-data', () => ({ getLiveADP: vi.fn(async () => entries) }))
vi.mock('@/lib/mock-draft/adp-realtime-adjuster', () => ({
  applyRealtimeAdpAdjustments: vi.fn(async (list: unknown[]) => ({ entries: list, adjustments: [] })),
}))
vi.mock('@/lib/sleeper/players-cache', () => ({ resolveSleeperIdsBatch: vi.fn(async () => new Map()) }))
vi.mock('@/lib/mock-draft/sport-player-pool', () => ({
  loadSportAwareDraftPlayerPool: vi.fn(async () => []),
  toSyntheticAdpEntries: vi.fn(() => []),
}))

import { POST as pickPath } from '@/app/api/mock-draft/pick-path/route'
import { POST as predictBoard } from '@/app/api/mock-draft/predict-board/route'
import { POST as snipeRadar } from '@/app/api/mock-draft/snipe-radar/route'
import { POST as tradeOptimizer } from '@/app/api/mock-draft/trade-optimizer/route'

const req = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost/api/mock-draft/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

function leagueOf(leagueSize: number | null) {
  return { id: 'L1', name: 'League', sport: 'NFL', isDynasty: false, leagueSize, teams: [], rosters: [], platformUserId: null }
}

const ROUTES = [
  ['pick-path', pickPath, { rounds: 3, simulations: 80 }],
  ['predict-board', predictBoard, { rounds: 2, simulations: 80 }],
  ['snipe-radar', snipeRadar, { rounds: 3 }],
  ['trade-optimizer', tradeOptimizer, { rounds: 3 }],
] as const

beforeEach(() => {
  h.league = null
})

describe.each(ROUTES)('%s uses the league size', (_name, handler, extra) => {
  it.each([4, 5, 10, 20])('a %i-team league drafts with that many teams', async (size) => {
    h.league = leagueOf(size)
    const res = await handler(req({ leagueId: 'L1', ...extra }))
    const json = (await res.json()) as { league?: { size?: number }; error?: string }
    expect(res.status, json.error).toBe(200)
    expect(json.league?.size).toBe(size)
  })

  it('a league with no stored size falls back to 12', async () => {
    h.league = leagueOf(null)
    const json = (await (await handler(req({ leagueId: 'L1', ...extra }))).json()) as { league?: { size?: number } }
    expect(json.league?.size).toBe(12)
  })
})

describe('pick-path picks are the real league slots', () => {
  it('4 teams, slot 2: overalls 2, 7, 10 (snake)', async () => {
    h.league = leagueOf(4)
    const json = (await (await pickPath(req({ leagueId: 'L1', rounds: 3, simulations: 80, draftSlot: 1 }))).json()) as {
      pickPaths: Array<{ overall: number; round: number; pick: number }>
    }
    expect(json.pickPaths.map((p) => [p.overall, p.round, p.pick])).toEqual([[2, 1, 2], [7, 2, 3], [10, 3, 2]])
  })

  it('20 teams, last slot: the 20/21 turn', async () => {
    h.league = leagueOf(20)
    const json = (await (await pickPath(req({ leagueId: 'L1', rounds: 3, simulations: 80, draftSlot: 19 }))).json()) as {
      pickPaths: Array<{ overall: number }>
    }
    expect(json.pickPaths.map((p) => p.overall)).toEqual([20, 21, 60])
  })
})
