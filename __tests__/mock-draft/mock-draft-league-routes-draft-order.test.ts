/**
 * The league-derived mock tools (pick path, board prediction, snipe radar, trade optimizer) draft in
 * the league's OWN pick order — linear, snake, or snake with third-round reversal — read from the
 * league's draft session, else its draft settings. They modelled snake for every league, so a linear
 * league's picks after round 1, and a 3RR league's from round 3, sat at slots it never picks.
 * The order rule is the live draft engine's (`getSlotInRoundForOverall`), not a copy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  league: null as Record<string, unknown> | null,
  session: null as { draftType: string; thirdRoundReversal: boolean } | null,
  settings: {} as Record<string, unknown>,
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findFirst: vi.fn(async () => h.league),
      findUnique: vi.fn(async () => ({ sport: 'NFL', leagueVariant: null, settings: h.settings })),
    },
    draftSession: { findFirst: vi.fn(async () => h.session) },
    leagueDraftCalibration: { findUnique: vi.fn(async () => null) },
    draftPredictionSnapshot: { create: vi.fn(async () => ({ id: 'snap' })) },
  },
}))
const POS = ['QB', 'RB', 'WR', 'TE']
const entries = Array.from({ length: 220 }, (_, i) => ({
  name: `Player ${i + 1}`, position: POS[i % 4]!, team: 'KC', adp: i + 1, adpFormatted: null, adpTrend: null, age: 25,
  value: 1000 - i, source: 'ffc' as const, ffcPlayerId: i + 1, timesDrafted: null, adpHigh: null, adpLow: null, adpStdev: null, bye: null,
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
import { getSlotInRoundForOverall } from '@/lib/live-draft-engine/DraftOrderService'
import { mockRoundOrder, mockTeamPickOveralls } from '@/lib/mock-draft/mockTeamCount'
import { mockDraftOrderFrom } from '@/lib/mock-draft/leagueMockDraftOrder'

const req = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost/api/mock-draft/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const leagueOf = (leagueSize: number) => ({ id: 'L1', name: 'League', sport: 'NFL', isDynasty: false, leagueSize, teams: [], rosters: [], platformUserId: null })

const ORDERS = {
  linear: { draftType: 'linear', thirdRoundReversal: false },
  snake: { draftType: 'snake', thirdRoundReversal: false },
  '3rr': { draftType: 'snake', thirdRoundReversal: true },
} as const
// Slot 1's overalls over 4 rounds.
const SLOT1: Record<number, Record<keyof typeof ORDERS, number[]>> = {
  4: { linear: [1, 5, 9, 13], snake: [1, 8, 9, 16], '3rr': [1, 8, 12, 13] },
  20: { linear: [1, 21, 41, 61], snake: [1, 40, 41, 80], '3rr': [1, 40, 60, 61] },
}

beforeEach(() => {
  h.league = null
  h.session = null
  h.settings = {}
})

describe('order helpers are the live draft engine rule', () => {
  it.each([4, 20])('%i teams: every pick of 6 rounds matches getSlotInRoundForOverall', (teams) => {
    for (const o of Object.values(ORDERS)) {
      for (let round = 1; round <= 6; round++) {
        const order = mockRoundOrder(teams, round, o)
        order.forEach((teamIdx, i) =>
          expect(teamIdx + 1).toBe(getSlotInRoundForOverall({ overall: (round - 1) * teams + i + 1, teamCount: teams, ...o })),
        )
      }
    }
  })

  it.each([4, 20] as const)('%i teams: slot 1 picks for linear, snake and 3RR', (teams) => {
    for (const [name, o] of Object.entries(ORDERS)) expect(mockTeamPickOveralls(teams, 0, 4, o)).toEqual(SLOT1[teams]![name as keyof typeof ORDERS])
  })

  it('3RR reverses rounds 2 and 3, then odd rounds', () => {
    const rev = (r: number) => mockRoundOrder(4, r, ORDERS['3rr'])[0] === 3
    expect([1, 2, 3, 4, 5, 6].map(rev)).toEqual([false, true, true, false, true, false])
  })

  it('reversal is a snake rule; anything but snake runs linear', () => {
    expect(mockDraftOrderFrom('linear', true)).toEqual({ draftType: 'linear', thirdRoundReversal: false })
    expect(mockDraftOrderFrom('auction', false)).toEqual({ draftType: 'linear', thirdRoundReversal: false })
    expect(mockDraftOrderFrom('snake', true)).toEqual({ draftType: 'snake', thirdRoundReversal: true })
    expect(mockDraftOrderFrom(undefined, undefined)).toEqual({ draftType: 'snake', thirdRoundReversal: false })
  })
})

const ROUTES = [
  ['pick-path', pickPath, { rounds: 4, simulations: 80 }],
  ['predict-board', predictBoard, { rounds: 2, simulations: 80 }],
  ['snipe-radar', snipeRadar, { rounds: 3 }],
  ['trade-optimizer', tradeOptimizer, { rounds: 3 }],
] as const

describe.each(ROUTES)('%s reads the league draft order', (_name, handler, extra) => {
  it.each([
    [4, 'linear'],
    [4, 'snake'],
    [4, '3rr'],
    [20, 'linear'],
    [20, 'snake'],
    [20, '3rr'],
  ] as const)('%i teams, %s (draft session)', async (size, name) => {
    h.league = leagueOf(size)
    h.session = { ...ORDERS[name] }
    const res = await handler(req({ leagueId: 'L1', ...extra }))
    const json = (await res.json()) as { league?: Record<string, unknown>; error?: string }
    expect(res.status, json.error).toBe(200)
    expect(json.league).toMatchObject({ size, ...ORDERS[name] })
  })

  it('no draft session yet: the league draft settings decide', async () => {
    h.league = leagueOf(10)
    h.settings = { draft_type: 'linear' }
    const json = (await (await handler(req({ leagueId: 'L1', ...extra }))).json()) as { league?: Record<string, unknown> }
    expect(json.league).toMatchObject({ draftType: 'linear', thirdRoundReversal: false })
    h.settings = { draft_type: 'snake', draft_third_round_reversal: true }
    const json3 = (await (await handler(req({ leagueId: 'L1', ...extra }))).json()) as { league?: Record<string, unknown> }
    expect(json3.league).toMatchObject({ draftType: 'snake', thirdRoundReversal: true })
  })
})

describe('pick-path: the user picks at the league order’s slots', () => {
  it.each([
    [4, 'linear'],
    [4, 'snake'],
    [4, '3rr'],
    [20, 'linear'],
    [20, 'snake'],
    [20, '3rr'],
  ] as const)('%i teams, %s, slot 1', async (size, name) => {
    h.league = leagueOf(size)
    h.session = { ...ORDERS[name] }
    const json = (await (await pickPath(req({ leagueId: 'L1', rounds: 4, simulations: 80, draftSlot: 0 }))).json()) as {
      pickPaths: Array<{ overall: number }>
    }
    expect(json.pickPaths.map((p) => p.overall)).toEqual(SLOT1[size]![name])
  })
})
