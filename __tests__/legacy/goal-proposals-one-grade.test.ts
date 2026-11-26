import { beforeEach, describe, expect, it, vi } from 'vitest'

// A plan holder: these tests are about what the paid route does once the plan gate lets the caller in
// (AF Legacy, locked 2026-11-17).
vi.mock('@/lib/subscription/entitlement-middleware', () => ({
  requireFeatureEntitlement: async () => ({ ok: true, decision: {}, tokenSpend: null, tokenPreview: null }),
}))
import { NextRequest } from 'next/server'

/*
 * The AF Legacy goal proposals (`/api/legacy/trade/goal-proposals`): the goal engine still BUILDS the
 * packages; each card SHOWS THE trade grade and none of the engine's own fairness score, acceptance
 * odds, acceptance drivers, acceptance-priced sweeteners/counter path, value totals or "You Win" tier.
 *
 * The engine is mocked to return a package carrying every one of those private numbers, so the test
 * proves the route strips them rather than that the engine happened not to produce them.
 */

const mockCreateGrader = vi.hoisted(() => vi.fn())
const mockGradeOf = vi.hoisted(() => vi.fn())
const mockSessionUser = vi.hoisted(() => vi.fn())
const mockGenerate = vi.hoisted(() => vi.fn())

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
  consumeRateLimit: vi.fn(() => ({ success: true, remaining: 7, retryAfterSec: 0 })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))
vi.mock('@/lib/trade-engine/accept-calibration', () => ({ getCalibratedWeights: vi.fn(async () => null) }))
vi.mock('@/lib/trade-engine/league-context-assembler', () => ({
  buildLeagueDecisionContext: vi.fn(async () => ({
    teams: [{ userId: 'me', teamId: '1' }],
    leagueConfig: { name: 'L', numTeams: 12, scoringType: 'PPR' },
    contextId: 'ctx-1',
    sourceFreshness: {},
  })),
  leagueContextToIntelligence: vi.fn(() => ({
    intelligence: { managerProfiles: {} },
    parsedRosters: [{ rosterId: 1, displayName: 'Me', record: { wins: 3, losses: 1 } }],
  })),
}))
vi.mock('@/lib/trade-engine/goal-proposal-engine', async () => {
  const actual = await vi.importActual<typeof import('@/lib/trade-engine/goal-proposal-engine')>('@/lib/trade-engine/goal-proposal-engine')
  return { ...actual, generateGoalProposals: mockGenerate }
})
vi.mock('@/lib/legacy/legacyOneGrade', () => ({
  createLegacyPackageGrader: mockCreateGrader,
  legacySessionUserId: mockSessionUser,
}))

import { POST, GOAL_TIER_LABELS } from '@/server/api-route-modules/legacy/trade/goal-proposals/route'

const GRADED = {
  graded: true as const,
  letter: 'D' as const,
  partnerLetter: 'B' as const,
  label: 'Slightly favors opponent',
  recommendation: 'Costs you more than it adds.',
  giveValue: 9000,
  getValue: 8000,
  basis: 'Dynasty · 12 teams · PPR',
}

/** A graded view at a given letter and gap (getValue − giveValue on a 10,000 side). */
const gradedAt = (letter: 'A' | 'B' | 'C' | 'D' | 'F', getValue: number) => ({ ...GRADED, letter, giveValue: 10000, getValue })

const PACKAGE = {
  tier: 'aggressive',
  tierLabel: 'Aggressive — You Win',
  give: [
    { id: 'breece_hall', type: 'PLAYER', name: 'Breece Hall', pos: 'RB', value: 7000, valuationIdentity: { provider: 'sleeper', id: '8155', position: 'RB' } },
    { id: '2027_1', type: 'PICK', pickSeason: 2027, round: 1, displayName: '2027 1st', value: 2000 },
  ],
  receive: [{ id: 'puka', type: 'PLAYER', name: 'Puka Nacua', pos: 'WR', value: 7600 }],
  giveTotal: 9000,
  receiveTotal: 7600,
  fairnessScore: 84,
  acceptProb: 62,
  acceptLabel: 'Likely',
  topDrivers: [{ name: 'Need fit', emoji: '🧩', direction: 'for', strength: 'strong', detail: '' }],
  counterPath: { description: 'If they balk', adjustments: [{ description: 'add a 3rd', expectedDelta: 8 }] },
  dmCopy: { opener: 'Hey', rationale: 'This fills your WR gap.', fallback: 'Happy to tweak.' },
  sweeteners: [{ suggestion: 'add a 3rd', expectedDelta: 6 }],
}

function post(body: unknown) {
  return (POST as unknown as (req: NextRequest) => Promise<Response>)(
    new NextRequest('http://localhost/api/legacy/trade/goal-proposals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

const BODY = { leagueId: 'sleeper-league-1', username: 'me', goal: 'wr_depth' }

beforeEach(() => {
  for (const m of [mockCreateGrader, mockGradeOf, mockSessionUser, mockGenerate]) m.mockReset()
  mockGate.mockReset()
  mockGate.mockResolvedValue(SIGNED_IN_AS_ME)
  mockSessionUser.mockResolvedValue('af-user-1')
  mockCreateGrader.mockResolvedValue(mockGradeOf)
  mockGradeOf.mockResolvedValue(GRADED)
  mockGenerate.mockReturnValue({
    goal: 'wr_depth',
    goalDescription: 'Add WR depth',
    partners: [{ rosterId: 2, displayName: 'Them', contenderTier: 'rebuild', matchReasons: ['Needs RB'], proposals: [PACKAGE] }],
    stats: { partnersEvaluated: 5, candidatesGenerated: 9, proposalsBuilt: 1 },
  })
})

describe('/api/legacy/trade/goal-proposals — each package carries the one grade', () => {
  it('grades through the one grader, on the league sent, for the signed-in user', async () => {
    expect((await post(BODY)).status).toBe(200)
    expect(mockCreateGrader).toHaveBeenCalledWith({ suppliedLeagueId: 'sleeper-league-1', userId: 'af-user-1', viewerSide: false })
  })

  it('from your side: give = the package you send (verified identity, picks by season/round), get = what you receive', async () => {
    await post(BODY)
    expect(mockGradeOf).toHaveBeenCalledWith(
      {
        assets: [
          { kind: 'player', name: 'Breece Hall', providerIdentity: { provider: 'sleeper', id: '8155', position: 'RB' } },
          { kind: 'pick', year: 2027, round: 1, label: '2027 1st' },
        ],
        unpriceable: [],
      },
      { assets: [{ kind: 'player', name: 'Puka Nacua' }], unpriceable: [] },
    )
  })

  it('the card carries the grade — an engine "You Win" at 62% accept that the one grade calls D reads D', async () => {
    const data = await (await post(BODY)).json()
    const p = data.partners[0].proposals[0]
    expect(p.grade).toEqual(GRADED)
    expect(p.tierLabel).toBe(GOAL_TIER_LABELS.aggressive)
    expect(JSON.stringify(data)).not.toMatch(/You Win|Fair Value/)
  })

  it('strips every number the engine judged the deal with', async () => {
    const data = await (await post(BODY)).json()
    const p = data.partners[0].proposals[0]
    for (const key of ['fairnessScore', 'acceptProb', 'acceptLabel', 'topDrivers', 'counterPath', 'sweeteners', 'giveTotal', 'receiveTotal']) {
      expect(p, key).not.toHaveProperty(key)
    }
    for (const a of [...p.give, ...p.receive]) expect(a).not.toHaveProperty('value')
    expect(p.dmCopy).toEqual(PACKAGE.dmCopy)
  })

  it('a withheld grade is sent withheld, with its reason', async () => {
    mockGradeOf.mockResolvedValue({ graded: false, reason: 'This league is not one of yours on AllFantasy.' })
    const data = await (await post(BODY)).json()
    expect(data.partners[0].proposals[0].grade).toEqual({ graded: false, reason: 'This league is not one of yours on AllFantasy.' })
  })
})

describe('/api/legacy/trade/goal-proposals — "your roster" is the caller\u2019s own', () => {
  it('refuses an anonymous caller (Origin alone is not authentication) before building anything', async () => {
    mockGate.mockResolvedValueOnce(refused(401))
    const { buildLeagueDecisionContext } = await import('@/lib/trade-engine/league-context-assembler')
    vi.mocked(buildLeagueDecisionContext).mockClear()
    const res = await post(BODY)
    expect(res.status).toBe(401)
    expect(buildLeagueDecisionContext).not.toHaveBeenCalled()
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('the body username is only COMPARED: a mismatch the gate refuses is a 403', async () => {
    mockGate.mockResolvedValueOnce(refused(403))
    const res = await post({ ...BODY, username: 'victim' })
    expect(res.status).toBe(403)
    expect(mockGate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ requestedUsername: 'victim' }))
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('builds the league context for the VERIFIED username, not the body string', async () => {
    mockGate.mockResolvedValueOnce({ ok: true, identity: { sleeperUsername: 'me', actorId: 'af-user-1', source: 'session' } })
    const { buildLeagueDecisionContext } = await import('@/lib/trade-engine/league-context-assembler')
    vi.mocked(buildLeagueDecisionContext).mockClear()
    expect((await post({ ...BODY, username: 'ME' })).status).toBe(200)
    expect(buildLeagueDecisionContext).toHaveBeenCalledWith({ leagueId: 'sleeper-league-1', username: 'me' })
  })

  it('keeps the CSRF origin check', async () => {
    const { validateRequestOrigin } = await import('@/lib/api-auth')
    vi.mocked(validateRequestOrigin).mockReturnValueOnce(false)
    expect((await post(BODY)).status).toBe(403)
    expect(mockGenerate).not.toHaveBeenCalled()
  })
})

describe('/api/legacy/trade/goal-proposals — the one grade decides what is shown, and in what order', () => {
  const pkg = (name: string) => ({ ...PACKAGE, receive: [{ id: name, type: 'PLAYER', name, pos: 'WR', value: 1 }] })
  const partner = (rosterId: number, names: string[]) => ({
    rosterId, displayName: `Team ${rosterId}`, contenderTier: 'rebuild', matchReasons: [], proposals: names.map(pkg),
  })
  const gradesByReceived = (g: Record<string, unknown>) =>
    mockGradeOf.mockImplementation(async (_give: unknown, get: { assets: Array<{ name: string }> }) => g[get.assets[0]!.name])
  const shown = (data: any) => data.partners.map((pt: any) => [pt.rosterId, pt.proposals.map((p: any) => p.receive[0].name)])

  beforeEach(() => {
    mockGenerate.mockReturnValue({
      goal: 'wr_depth', goalDescription: 'Add WR depth',
      partners: [partner(2, ['a1', 'a2']), partner(3, ['b1', 'b2'])],
      stats: { partnersEvaluated: 2, candidatesGenerated: 4, proposalsBuilt: 4 },
    })
  })

  it('an A or an F is never proposed, and a partner with nothing proposable left is not shown', async () => {
    gradesByReceived({ a1: gradedAt('F', 6000), a2: gradedAt('A', 14000), b1: gradedAt('C', 10000), b2: gradedAt('F', 5000) })
    const data = await (await post(BODY)).json()
    expect(shown(data)).toEqual([[3, ['b1']]])
  })

  it('packages closest to even first, and partners by their best package — not the engine order', async () => {
    gradesByReceived({ a1: gradedAt('D', 8200), a2: gradedAt('B', 11200), b1: gradedAt('C', 9700), b2: gradedAt('D', 8500) })
    const data = await (await post(BODY)).json()
    // Partner 3's best is 3% from even, partner 2's is 11%: partner 3 first; within each, nearest even first.
    expect(shown(data)).toEqual([[3, ['b1', 'b2']], [2, ['a2', 'a1']]])
  })

  it('CHANGES when the one grade changes — the same engine output, a different canonical verdict, a different card', async () => {
    gradesByReceived({ a1: gradedAt('C', 10000), a2: gradedAt('D', 8000), b1: gradedAt('D', 8100), b2: gradedAt('F', 5000) })
    const first = shown(await (await post(BODY)).json())
    gradesByReceived({ a1: gradedAt('F', 5000), a2: gradedAt('F', 5000), b1: gradedAt('C', 10000), b2: gradedAt('B', 11000) })
    const second = shown(await (await post(BODY)).json())
    expect(first).toEqual([[2, ['a1', 'a2']], [3, ['b1']]])
    expect(second).toEqual([[3, ['b1', 'b2']]])
  })

  it('a withheld package beside graded ones is dropped', async () => {
    gradesByReceived({ a1: { graded: false, reason: 'Puka could not be found.' }, a2: gradedAt('C', 10000), b1: gradedAt('C', 9900), b2: { graded: false, reason: 'x' } })
    expect(shown(await (await post(BODY)).json())).toEqual([[2, ['a2']], [3, ['b1']]])
  })

  it('nothing gradeable (not your league): the engine order is kept and every package says why', async () => {
    mockGradeOf.mockResolvedValue({ graded: false, reason: 'This league is not one of yours on AllFantasy.' })
    const data = await (await post(BODY)).json()
    expect(shown(data)).toEqual([[2, ['a1', 'a2']], [3, ['b1', 'b2']]])
    for (const pt of data.partners) for (const p of pt.proposals) expect(p.grade.graded).toBe(false)
  })
})
