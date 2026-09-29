import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
 * The Trade Hub's live preview (`/api/legacy/trade/quick-evaluate`) prints THE trade grade — the
 * full analyzer's letter for the same deal — and no verdict, fairness or acceptance rate of its own.
 *
 * The one grader is mocked at the legacy door (`createLegacyPackageGrader`) so the test can see
 * EXACTLY what the route hands it; the old driver model is mocked too, only to prove it is never
 * asked again.
 */

const mockCreateGrader = vi.hoisted(() => vi.fn())
const mockGradeOf = vi.hoisted(() => vi.fn())
const mockSessionUser = vi.hoisted(() => vi.fn())
const mockDrivers = vi.hoisted(() => vi.fn())
const mockTendencies = vi.hoisted(() => vi.fn())

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: unknown) => handler }))
vi.mock('@/lib/legacy/legacyOneGrade', () => ({
  createLegacyPackageGrader: mockCreateGrader,
  legacySessionUserId: mockSessionUser,
}))
vi.mock('@/lib/fantasycalc-db', () => ({
  getFantasyCalcValuesDbFirst: vi.fn(async () => [
    { player: { name: 'Josh Allen', position: 'QB' }, value: 9000 },
    { player: { name: 'Puka Nacua', position: 'WR' }, value: 7000 },
  ]),
}))
vi.mock('@/lib/trade-engine/trade-engine', async () => {
  const actual = await vi.importActual<typeof import('@/lib/trade-engine/trade-engine')>('@/lib/trade-engine/trade-engine')
  return { ...actual, computeTradeDrivers: mockDrivers }
})
vi.mock('@/lib/trade-engine/manager-tendency-engine', () => ({
  computeManagerTendencies: mockTendencies,
  computeAcceptProbability: vi.fn(),
}))

import { POST } from '@/server/api-route-modules/legacy/trade/quick-evaluate/route'

const ONE_GRADE = {
  graded: true as const,
  letter: 'D' as const,
  partnerLetter: 'B' as const,
  label: 'Slightly favors opponent',
  recommendation: 'Ask for a little more back.',
  giveValue: 9000,
  getValue: 7400,
  basis: 'Dynasty · Superflex · 12 teams · PPR',
}

function post(body: unknown) {
  return (POST as unknown as (req: NextRequest) => Promise<Response>)(
    new NextRequest('http://localhost/api/legacy/trade/quick-evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

const DEAL = {
  // The Trade Hub's orientation: the graded side RECEIVES `assetsYouGet` and SENDS `assetsYouGive`.
  assetsYouGet: [
    { type: 'player', name: 'Puka Nacua', pos: 'WR', id: '9493' },
    { type: 'pick', year: 2027, round: 1, pickNumber: 2 },
  ],
  assetsYouGive: [
    { type: 'player', name: 'Josh Allen', pos: 'QB', id: '4984' },
    { type: 'faab', amount: 15 },
  ],
  yourRoster: [{ id: '4984', name: 'Josh Allen', pos: 'QB' }],
  yourStarters: ['4984'],
  rosterPositions: ['QB', 'WR', 'FLEX'],
  numTeams: 12,
  leagueId: 'sleeper-league-1',
  suggestSweetener: true,
  sweetenerCandidates: [{ type: 'player', name: 'Bench Guy', pos: 'RB', id: '1' }],
}

beforeEach(() => {
  mockCreateGrader.mockReset()
  mockGradeOf.mockReset()
  mockSessionUser.mockReset()
  mockDrivers.mockReset()
  mockTendencies.mockReset()
  mockSessionUser.mockResolvedValue('af-user-1')
  mockGradeOf.mockResolvedValue(ONE_GRADE)
  mockCreateGrader.mockResolvedValue(mockGradeOf)
})

describe('/api/legacy/trade/quick-evaluate — the live preview is the one grade', () => {
  it('grades the deal through the one grader, on the league sent, for the signed-in user', async () => {
    const res = await post(DEAL)
    expect(res.status).toBe(200)
    expect(mockCreateGrader).toHaveBeenCalledWith({ suppliedLeagueId: 'sleeper-league-1', userId: 'af-user-1', viewerSide: false })
  })

  it('with the full analyzer’s orientation and inputs: give = assetsYouGive, get = assetsYouGet, players by name', async () => {
    await post(DEAL)
    expect(mockGradeOf).toHaveBeenCalledTimes(1)
    const [giveIn, getIn] = mockGradeOf.mock.calls[0]!
    expect(giveIn).toEqual({ assets: [{ kind: 'player', name: 'Josh Allen' }, { kind: 'faab', amount: 15 }], unpriceable: [] })
    // pickNumber 2 of 12 → the analyzer's "early" tier.
    expect(getIn).toEqual({ assets: [{ kind: 'player', name: 'Puka Nacua' }, { kind: 'pick', year: 2027, round: 1, tier: 'early' }], unpriceable: [] })
  })

  it('returns the grade as the one grader gave it', async () => {
    const data = await (await post(DEAL)).json()
    expect(data.success).toBe(true)
    expect(data.grade).toEqual(ONE_GRADE)
  })

  it('prints no verdict, fairness, confidence, factor score, acceptance rate or accept-ranked sweetener of its own', async () => {
    const data = await (await post(DEAL)).json()
    for (const key of [
      'verdict', 'lean', 'fairnessDelta', 'acceptProbability', 'acceptLabel', 'totalScore', 'confidence',
      'scores', 'acceptDrivers', 'riskFlags', 'marketDeltaPct', 'sweeteners', 'assetValues', 'newsAlerts', 'lineupDelta',
    ]) {
      expect(data, key).not.toHaveProperty(key)
    }
    expect(mockDrivers).not.toHaveBeenCalled()
  })

  it('a withheld grade is sent withheld, with its reason — nothing stands in for it', async () => {
    mockGradeOf.mockResolvedValue({ graded: false, reason: 'This league is not one of yours on AllFantasy.' })
    const data = await (await post(DEAL)).json()
    expect(data.grade).toEqual({ graded: false, reason: 'This league is not one of yours on AllFantasy.' })
    expect(data).not.toHaveProperty('verdict')
  })

  it('keeps the lineup slot map, which is not a verdict', async () => {
    const data = await (await post(DEAL)).json()
    expect(Array.isArray(data.slotMap?.deltas)).toBe(true)
  })

  it('an empty deal is a 400, and nothing is graded', async () => {
    const res = await post({ assetsYouGet: [], assetsYouGive: [] })
    expect(res.status).toBe(400)
    expect(mockCreateGrader).not.toHaveBeenCalled()
  })
})
