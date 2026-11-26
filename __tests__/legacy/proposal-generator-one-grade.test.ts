import { beforeEach, describe, expect, it, vi } from 'vitest'

// A plan holder: these tests are about what the paid route does once the plan gate lets the caller in.
vi.mock('@/lib/subscription/entitlement-middleware', () => ({
  requireFeatureEntitlement: async () => ({ ok: true, decision: {}, tokenSpend: null, tokenPreview: null }),
}))
import { NextRequest } from 'next/server'

/*
 * The AF Legacy proposal generator (`/api/legacy/trade/proposal-generator`) SEARCHES for candidate
 * packages on the FantasyCalc board, and the one grader decides which are shown and how they are
 * labelled — no "fairness N/100", no acceptance model, no hybrid-valuation filter, no "Slight Edge /
 * Fair & Balanced / Overpay" verdict-labels.
 *
 * The one grader is mocked at the legacy door so the test sees exactly what each candidate is graded
 * on, and can change its verdict to prove the shown set follows it. `lib/hybrid-valuation` is mocked
 * with spies only to prove it is never asked.
 */

const mockCreateGrader = vi.hoisted(() => vi.fn())
const mockGradeOf = vi.hoisted(() => vi.fn())
const mockSessionUser = vi.hoisted(() => vi.fn())
const mockChat = vi.hoisted(() => vi.fn())
const mockAcceptance = vi.hoisted(() => vi.fn())
const mockLogOffer = vi.hoisted(() => vi.fn())

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: unknown) => handler }))
// Origin is CSRF protection only. Identity comes from the shared legacy gate: the caller is signed
// in as the account linked to Sleeper user `me`, the username the request body names.
vi.mock('@/lib/api-auth', () => ({
  validateRequestOrigin: vi.fn(() => true),
  forbiddenResponse: vi.fn((msg: string) => new Response(JSON.stringify({ error: msg }), { status: 403 })),
}))
const mockGate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/legacy/requireLegacySleeperIdentity', () => ({
  requireLegacySleeperIdentity: (...args: unknown[]) => mockGate(...args),
}))
const SIGNED_IN_AS_ME = { ok: true, identity: { sleeperUsername: 'me', actorId: 'af-user-1', source: 'session' } }
const refused = (status: number) => ({ ok: false, response: new Response(JSON.stringify({ error: 'refused' }), { status }) })
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
const mockHybridPrice = vi.hoisted(() => vi.fn())
vi.mock('@/lib/hybrid-valuation', () => ({ pricePlayer: mockHybridPrice, pricePick: mockHybridPrice, priceAssets: mockHybridPrice }))
// The SEARCH board: FantasyCalc rows by name. Search values choose candidates only.
vi.mock('@/lib/fantasycalc', () => ({
  findPlayerByName: vi.fn((_players: unknown, name: string) => (VALUES[name] != null ? { value: VALUES[name] } : null)),
  getPickValue: vi.fn(() => 0),
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

const graded = (letter: 'A' | 'B' | 'C' | 'D' | 'F', getValue = 5200) => ({
  graded: true as const,
  letter,
  partnerLetter: 'C' as const,
  label: letter === 'C' ? 'Even' : 'Slightly favors you',
  recommendation: 'Send it.',
  giveValue: 5000,
  getValue,
  basis: 'Dynasty · 12 teams · PPR',
})

/** The names a give-side GradeInputs carries, as one sorted key — which candidate a grader call is. */
const giveKey = (give: { assets: Array<{ name?: string }> }) => give.assets.map((a) => a.name).sort().join('+')
const gradeByGive = (table: Record<string, ReturnType<typeof graded> | { graded: false; reason: string }>, fallback: unknown = graded('F', 1000)) =>
  mockGradeOf.mockImplementation(async (give: { assets: Array<{ name?: string }> }) => table[giveKey(give)] ?? fallback)
const shownOffers = (data: any) => data.proposals.map((p: any) => [p.label, p.myOffer.map((a: any) => a.name).sort().join('+')])

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
  mockGate.mockReset()
  mockGate.mockResolvedValue(SIGNED_IN_AS_ME)
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

  it('grades every CANDIDATE from your side: give = what you send, get = what you asked for, players by name', async () => {
    await post(BODY)
    expect(mockGradeOf.mock.calls.length).toBeGreaterThan(3)
    for (const [giveIn, getIn] of mockGradeOf.mock.calls) {
      expect(giveIn.unpriceable).toEqual([])
      for (const a of giveIn.assets) expect(a).toEqual({ kind: 'player', name: expect.stringMatching(/^Player [A-E]$/) })
      expect(getIn).toEqual({ assets: [{ kind: 'player', name: 'Josh Allen' }], unpriceable: [] })
    }
  })

  it('never prices anything through hybrid-valuation', async () => {
    expect((await post(BODY)).status).toBe(200)
    expect(mockHybridPrice).not.toHaveBeenCalled()
  })

  it('each package shows the grade the one grader gave it, and nothing of its own', async () => {
    gradeByGive({ 'Player A+Player B': graded('B', 5600), 'Player A+Player C': graded('C') })
    const data = await (await post(BODY)).json()
    expect(data.proposals.map((p: any) => p.grade)).toEqual([graded('B', 5600), graded('C')])
    for (const p of data.proposals) {
      for (const key of ['fairnessScore', 'acceptanceModel', 'fairnessNote', 'myTotal', 'theirTotal', 'delta']) {
        expect(p, key).not.toHaveProperty(key)
      }
      for (const a of [...p.myOffer, ...p.theirOffer]) expect(a).not.toHaveProperty('value')
    }
    for (const key of ['bestAcceptanceIndex', 'desiredTotal', 'valuationSources']) expect(data, key).not.toHaveProperty(key)
    expect(mockAcceptance).not.toHaveBeenCalled()
  })

  it('labels are read off the one grade (B lighter, C matched, D stronger), never who wins on the search values', async () => {
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

describe('/api/legacy/trade/proposal-generator — the one grade filters, ranks and labels', () => {
  it('a B, C and D become the lighter, matched and stronger offers; an A or F is never shown', async () => {
    gradeByGive({
      'Player D': graded('A', 9000),
      'Player A+Player B': graded('B', 5600),
      'Player A+Player C': graded('C'),
      'Player E': graded('D', 4300),
      'Player B+Player C': graded('F', 2000),
    })
    const data = await (await post(BODY)).json()
    expect(shownOffers(data)).toEqual([
      [PROPOSAL_LABELS.lighter, 'Player A+Player B'],
      [PROPOSAL_LABELS.matched, 'Player A+Player C'],
      [PROPOSAL_LABELS.stronger, 'Player E'],
    ])
  })

  it('within a letter, the candidate closest to even is shown', async () => {
    gradeByGive({ 'Player D': graded('C', 5400), 'Player A+Player C': graded('C', 5100) })
    expect(shownOffers(await (await post(BODY)).json())).toEqual([[PROPOSAL_LABELS.matched, 'Player A+Player C']])
  })

  it('CHANGES when the one grade changes — same roster, same search, a different canonical verdict, a different offer', async () => {
    gradeByGive({ 'Player A+Player C': graded('C') })
    const first = shownOffers(await (await post(BODY)).json())
    gradeByGive({ 'Player E': graded('C') })
    const second = shownOffers(await (await post(BODY)).json())
    expect(first).toEqual([[PROPOSAL_LABELS.matched, 'Player A+Player C']])
    expect(second).toEqual([[PROPOSAL_LABELS.matched, 'Player E']])
  })

  it('every candidate graded A or F: nothing is proposed, and the route says so', async () => {
    mockGradeOf.mockResolvedValue(graded('F', 1000))
    const res = await post(BODY)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/grades within reach of even/)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('nothing gradeable (not your league): the search’s best build per band, each carrying the withheld reason', async () => {
    mockGradeOf.mockResolvedValue({ graded: false, reason: 'Not your league.' })
    const data = await (await post(BODY)).json()
    expect(data.proposals.length).toBeGreaterThan(0)
    for (const p of data.proposals) expect(p.grade).toEqual({ graded: false, reason: 'Not your league.' })
    expect(data.proposals.map((p: any) => p.label)).toEqual(
      Object.values(PROPOSAL_LABELS).filter((l) => data.proposals.some((p: any) => p.label === l)),
    )
  })
})

describe('/api/legacy/trade/proposal-generator — a paid model call, as the caller only', () => {
  it('refuses an anonymous caller (Origin alone is not authentication) with no model call and no writes', async () => {
    mockGate.mockResolvedValueOnce(refused(401))
    const { autoLogDecision } = await import('@/lib/decision-log')
    vi.mocked(autoLogDecision).mockClear()
    const res = await post(BODY)
    expect(res.status).toBe(401)
    expect(mockChat).not.toHaveBeenCalled()
    expect(mockLogOffer).not.toHaveBeenCalled()
    expect(autoLogDecision).not.toHaveBeenCalled()
  })

  it('the body username is only COMPARED: a mismatch the gate refuses is a 403', async () => {
    mockGate.mockResolvedValueOnce(refused(403))
    const res = await post({ ...BODY, username: 'victim' })
    expect(res.status).toBe(403)
    expect(mockGate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ requestedUsername: 'victim' }))
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('no guests (model spend), and a per-actor rate limit', async () => {
    await post(BODY)
    const opts = mockGate.mock.calls[0]![1] as { allowGuest?: boolean; rateLimit?: unknown }
    expect(opts.allowGuest).toBeFalsy()
    expect(opts.rateLimit).toBeDefined()
  })

  it('decision-log and trade-offer writes are keyed on the VERIFIED username, not the body string', async () => {
    const { autoLogDecision } = await import('@/lib/decision-log')
    vi.mocked(autoLogDecision).mockClear()
    expect((await post({ ...BODY, username: 'ME' })).status).toBe(200)
    expect(autoLogDecision).toHaveBeenCalledWith(expect.objectContaining({ userId: 'me' }))
    for (const [arg] of mockLogOffer.mock.calls) expect((arg as { senderUserId: string }).senderUserId).toBe('me')
    expect(mockLogOffer).toHaveBeenCalled()
  })
})
