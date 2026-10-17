import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
 * The AF Legacy proposal generator (`/api/legacy/trade/proposal-generator`) still BUILDS packages on
 * its own values, and SHOWS each one's grade from the one grader — no "fairness N/100", no
 * acceptance model, no "Slight Edge / Fair & Balanced / Overpay" verdict-labels.
 *
 * The one grader is mocked at the legacy door so the test sees exactly what each package is graded
 * on; the acceptance model is mocked only to prove it is never asked again.
 */

const mockCreateGrader = vi.hoisted(() => vi.fn())
const mockGradeOf = vi.hoisted(() => vi.fn())
const mockSessionUser = vi.hoisted(() => vi.fn())
const mockChat = vi.hoisted(() => vi.fn())
const mockAcceptance = vi.hoisted(() => vi.fn())
const mockLogOffer = vi.hoisted(() => vi.fn())

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: unknown) => handler }))
vi.mock('@/lib/api-auth', () => ({
  requireAuthOrOrigin: vi.fn(() => ({ authenticated: true, user: null })),
  forbiddenResponse: vi.fn(),
}))
vi.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: vi.fn(() => ({ success: true, remaining: 9, retryAfterSec: 0 })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))
vi.mock('@/lib/legacy/legacyOneGrade', () => ({
  createLegacyPackageGrader: mockCreateGrader,
  legacySessionUserId: mockSessionUser,
}))
const VALUES: Record<string, number> = {
  'Josh Allen': 1000, // what you want
  'Player A': 400,
  'Player B': 500,
  'Player C': 600,
  'Player D': 950,
  'Player E': 1100,
}
vi.mock('@/lib/hybrid-valuation', () => ({
  pricePlayer: vi.fn(async (name: string) => ({ value: VALUES[name] ?? 0, source: 'test' })),
  pricePick: vi.fn(async (p: { year: number; round: number }) => ({ name: `${p.year} Round ${p.round}`, value: 0, source: 'test' })),
}))
vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst: vi.fn(async () => []) }))
vi.mock('@/lib/opponent-tendencies', () => ({ getCachedOpponentProfile: vi.fn(async () => null), formatOpponentForPrompt: vi.fn(() => '') }))
vi.mock('@/lib/openai-client', () => ({
  openaiChatJson: mockChat,
  parseJsonContentFromChatCompletion: (d: any) => JSON.parse(d.choices[0].message.content),
}))
vi.mock('@/lib/decision-log', () => ({ autoLogDecision: vi.fn() }))
vi.mock('@/lib/analytics/confidence-risk-engine', () => ({
  computeConfidenceRisk: vi.fn(() => ({ confidenceScore01: 0.5, riskProfile: 'moderate', numericConfidence: 50, confidenceLevel: 'medium', volatilityLevel: 'low', riskTags: [], explanation: '' })),
  getHistoricalHitRate: vi.fn(async () => null),
}))
vi.mock('@/lib/analytics/trade-acceptance', () => ({ computeTradeAcceptance: mockAcceptance, suggestOptimizations: vi.fn() }))
vi.mock('@/lib/trade-engine/trade-event-logger', () => ({ logTradeOfferEvent: mockLogOffer }))

import { POST, PROPOSAL_LABELS } from '@/server/api-route-modules/legacy/trade/proposal-generator/route'

const graded = (letter: 'A' | 'B' | 'C' | 'D' | 'F') => ({
  graded: true as const,
  letter,
  partnerLetter: 'C' as const,
  label: letter === 'C' ? 'Even' : 'Slightly favors you',
  recommendation: 'Send it.',
  giveValue: 5000,
  getValue: 5200,
  basis: 'Dynasty · 12 teams · PPR',
})

const BODY = {
  leagueId: 'sleeper-league-1',
  username: 'me',
  myRosterId: '1',
  targetRosterId: '2',
  desiredAssets: [{ type: 'player', id: '4984', name: 'Josh Allen', pos: 'QB' }],
  myTeam: {
    displayName: 'Me',
    players: ['Player A', 'Player B', 'Player C', 'Player D', 'Player E'].map((name, i) => ({ id: String(100 + i), name, pos: 'WR' })),
    draftPicks: [],
  },
  targetTeam: { displayName: 'Them', players: [{ id: '4984', name: 'Josh Allen', pos: 'QB' }], draftPicks: [] },
  format: 'dynasty',
  isSuperFlex: true,
}

function post(body: unknown) {
  return (POST as unknown as (req: NextRequest) => Promise<Response>)(
    new NextRequest('http://localhost/api/legacy/trade/proposal-generator', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  for (const m of [mockCreateGrader, mockGradeOf, mockSessionUser, mockChat, mockAcceptance, mockLogOffer]) m.mockReset()
  mockSessionUser.mockResolvedValue('af-user-1')
  mockCreateGrader.mockResolvedValue(mockGradeOf)
  mockGradeOf.mockResolvedValue(graded('C'))
  mockLogOffer.mockResolvedValue(undefined)
  mockChat.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ proposals: { matched: { theirPitch: 'They need depth.', yourAdvantage: 'You get a QB.', tradePitch: 'Want Allen?' } } }) } }],
  })
})

describe('/api/legacy/trade/proposal-generator — packages carry the one grade', () => {
  it('grades through the one grader, on the league sent, for the signed-in user', async () => {
    const res = await post(BODY)
    expect(res.status).toBe(200)
    expect(mockCreateGrader).toHaveBeenCalledWith({ suppliedLeagueId: 'sleeper-league-1', userId: 'af-user-1', viewerSide: false })
  })

  it('grades every package from your side: give = what you send, get = what you asked for, players by name', async () => {
    const data = await (await post(BODY)).json()
    expect(data.proposals.length).toBeGreaterThan(0)
    expect(mockGradeOf).toHaveBeenCalledTimes(data.proposals.length)
    data.proposals.forEach((p: any, i: number) => {
      const [giveIn, getIn] = mockGradeOf.mock.calls[i]!
      expect(giveIn).toEqual({ assets: p.myOffer.map((a: any) => ({ kind: 'player', name: a.name })), unpriceable: [] })
      expect(getIn).toEqual({ assets: [{ kind: 'player', name: 'Josh Allen' }], unpriceable: [] })
    })
  })

  it('each package shows the grade the one grader gave it, and nothing of its own', async () => {
    mockGradeOf.mockResolvedValueOnce(graded('B')).mockResolvedValueOnce(graded('C')).mockResolvedValueOnce({ graded: false, reason: 'Not your league.' })
    const data = await (await post(BODY)).json()
    expect(data.proposals.map((p: any) => p.grade)).toEqual(
      [graded('B'), graded('C'), { graded: false, reason: 'Not your league.' }].slice(0, data.proposals.length),
    )
    for (const p of data.proposals) {
      for (const key of ['fairnessScore', 'acceptanceModel', 'fairnessNote', 'myTotal', 'theirTotal', 'delta']) {
        expect(p, key).not.toHaveProperty(key)
      }
      for (const a of [...p.myOffer, ...p.theirOffer]) expect(a).not.toHaveProperty('value')
    }
    for (const key of ['bestAcceptanceIndex', 'desiredTotal', 'valuationSources']) expect(data, key).not.toHaveProperty(key)
    expect(mockAcceptance).not.toHaveBeenCalled()
  })

  it('labels say how a package was built, never who wins it', async () => {
    const data = await (await post(BODY)).json()
    const allowed = Object.values(PROPOSAL_LABELS) as string[]
    for (const p of data.proposals) expect(allowed).toContain(p.label)
    expect(JSON.stringify(data)).not.toMatch(/Slight Edge|Fair & Balanced|Overpay/)
  })

  it('the AI is handed the letter to explain — no fairness score, no acceptance figure, no value totals', async () => {
    await post(BODY)
    const prompt = mockChat.mock.calls[0]![0].messages.map((m: { content: string }) => m.content).join('\n')
    expect(prompt).toMatch(/AllFantasy trade grade for me: C \("Even"\)/)
    expect(prompt).not.toMatch(/Fairness: \d+\/100|acceptance likelihood is|val: \d+|\(total \d+\)/)
  })

  it('the offer log records the letter, and no acceptance probability', async () => {
    await post(BODY)
    expect(mockLogOffer).toHaveBeenCalled()
    for (const [arg] of mockLogOffer.mock.calls) {
      expect(arg.acceptProb).toBeNull()
      expect(arg.verdict).toBe('C')
    }
  })
})
