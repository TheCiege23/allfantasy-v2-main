/**
 * Route-contract tests for app/api/trade-value/analyze/route.ts — Phase 18.
 * Mocks only the true external boundaries (session, rate limit, the
 * authoritative engine, and the new shadow-compare seam), same pattern as
 * the Waiver route-contract tests (Phase 12).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetServerSession, mockRateLimit, mockRunTradeConsoleAnalysis, mockShouldRunSharedTradeShadowCompare, mockRunSharedTradeValueShadowCompare } =
  vi.hoisted(() => ({
    mockGetServerSession: vi.fn(),
    mockRateLimit: vi.fn(),
    mockRunTradeConsoleAnalysis: vi.fn(),
    mockShouldRunSharedTradeShadowCompare: vi.fn(),
    mockRunSharedTradeValueShadowCompare: vi.fn(),
  }))

vi.mock('next-auth', () => ({ getServerSession: mockGetServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mockRateLimit, getClientIp: () => '127.0.0.1' }))
vi.mock('@/lib/trade-value-console/runTradeConsoleAnalysis', () => ({ runTradeConsoleAnalysis: mockRunTradeConsoleAnalysis }))
vi.mock('@/lib/decision-os/trade/sharedServiceTradeValueShadowCompare', () => ({
  shouldRunSharedTradeShadowCompare: mockShouldRunSharedTradeShadowCompare,
  runSharedTradeValueShadowCompare: mockRunSharedTradeValueShadowCompare,
}))

import { POST } from '@/app/api/trade-value/analyze/route'

const VALID_BODY = {
  sportFilter: 'ALL',
  strategy: 'neutral',
  teamContext: 'neutral',
  sideGive: [{ kind: 'player', name: 'A' }],
  sideGet: [{ kind: 'player', name: 'B' }],
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/trade-value/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const OK_RESULT = {
  ok: true,
  analysisMode: 'global',
  effectiveSport: 'NFL',
  analysisScope: 'general',
  league: null,
  labels: { fairnessLabel: 'x', sideAdvantage: 'even', confidenceLabel: 'x' },
  fairnessScore: 50,
  confidenceScore: 50,
  percentDiff: 0,
  giveTotal: 100,
  getTotal: 100,
  giveMarket: 100,
  getMarket: 100,
  degraded: false,
  dataGaps: [],
  dataSources: [],
  lastUpdated: null,
  players: {
    give: [{ name: 'A', playerId: null, sport: 'NFL', position: 'WR', team: 'KC', headshotUrl: null, logoUrl: null, injuryStatus: null, dataSource: 'x', composite: 1, marketValue: 100, pricedSource: 'fantasycalc' }],
    get: [{ name: 'B', playerId: null, sport: 'NFL', position: 'WR', team: 'KC', headshotUrl: null, logoUrl: null, injuryStatus: null, dataSource: 'x', composite: 1, marketValue: 100, pricedSource: 'fantasycalc' }],
  },
  rosterSummary: { lineupSimulation: false, yourRosterPlayers: 0, theirRosterPlayers: 0, opponentTeams: [] },
  secondary: {} as never,
  drivers: {},
  evaluation: { bullets: [], sensitivity: '' },
  negotiationToolkit: null,
  tradeIntelligence: {} as never,
  chimmyPayload: {},
  validation: {} as never,
  sourceFlags: {} as never,
  summaryLine: '',
  dataQuality: 'full',
  tradeWindow: null,
}

describe('POST /api/trade-value/analyze — Phase 18 shadow-compare wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRateLimit.mockReturnValue({ success: true })
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockRunTradeConsoleAnalysis.mockResolvedValue(OK_RESULT)
    mockShouldRunSharedTradeShadowCompare.mockReturnValue(false)
    mockRunSharedTradeValueShadowCompare.mockResolvedValue({ ran: false, status: 'unsupported' })
  })

  it('never calls the shadow compare when the flag is disabled', async () => {
    const res = await POST(makeRequest(VALID_BODY) as never)
    expect(res.status).toBe(200)
    expect(mockRunSharedTradeValueShadowCompare).not.toHaveBeenCalled()
  })

  it('calls the shadow compare exactly once with real player assets when enabled', async () => {
    mockShouldRunSharedTradeShadowCompare.mockReturnValue(true)
    await POST(makeRequest(VALID_BODY) as never)
    expect(mockRunSharedTradeValueShadowCompare).toHaveBeenCalledTimes(1)
    const args = mockRunSharedTradeValueShadowCompare.mock.calls[0][0]
    expect(args.assets).toHaveLength(2)
    expect(args.assets[0]).toMatchObject({ name: 'A', authoritativeMarketValue: 100 })
  })

  it('excludes pick/faab/unknown-source lines from the shadow comparison payload', async () => {
    mockShouldRunSharedTradeShadowCompare.mockReturnValue(true)
    mockRunTradeConsoleAnalysis.mockResolvedValue({
      ...OK_RESULT,
      players: {
        give: [
          { ...OK_RESULT.players.give[0] },
          { name: '2026 1st', playerId: null, sport: 'NFL', position: '-', team: '-', headshotUrl: null, logoUrl: null, injuryStatus: null, dataSource: 'x', composite: 0, marketValue: 500, pricedSource: 'pick' },
        ],
        get: [{ name: 'FAAB', playerId: null, sport: 'NFL', position: '-', team: '-', headshotUrl: null, logoUrl: null, injuryStatus: null, dataSource: 'x', composite: 0, marketValue: 50, pricedSource: 'faab' }],
      },
    })
    await POST(makeRequest(VALID_BODY) as never)
    const args = mockRunSharedTradeValueShadowCompare.mock.calls[0][0]
    expect(args.assets).toHaveLength(1)
    expect(args.assets[0].name).toBe('A')
  })

  it('byte-identical response whether the flag is on or off', async () => {
    mockShouldRunSharedTradeShadowCompare.mockReturnValue(false)
    const off = await POST(makeRequest(VALID_BODY) as never)
    const offBody = await off.json()

    mockShouldRunSharedTradeShadowCompare.mockReturnValue(true)
    const on = await POST(makeRequest(VALID_BODY) as never)
    const onBody = await on.json()

    expect(onBody).toEqual(offBody)
  })

  it('response is unaffected even if the shared shadow compare throws', async () => {
    mockShouldRunSharedTradeShadowCompare.mockReturnValue(true)
    mockRunSharedTradeValueShadowCompare.mockRejectedValue(new Error('shared service exploded'))
    const res = await POST(makeRequest(VALID_BODY) as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(JSON.stringify(body)).not.toContain('shared service exploded')
  })

  it('never calls the shadow compare when the authoritative engine itself fails', async () => {
    mockShouldRunSharedTradeShadowCompare.mockReturnValue(true)
    mockRunTradeConsoleAnalysis.mockResolvedValue({ ok: false, error: 'nope', code: 'VALIDATION' })
    const res = await POST(makeRequest(VALID_BODY) as never)
    expect(res.status).toBe(400)
    expect(mockRunSharedTradeValueShadowCompare).not.toHaveBeenCalled()
  })

  it('rate-limit (429) is preserved regardless of the flag, and shadow compare never runs', async () => {
    mockShouldRunSharedTradeShadowCompare.mockReturnValue(true)
    mockRateLimit.mockReturnValue({ success: false })
    const res = await POST(makeRequest(VALID_BODY) as never)
    expect(res.status).toBe(429)
    expect(mockRunSharedTradeValueShadowCompare).not.toHaveBeenCalled()
    expect(mockRunTradeConsoleAnalysis).not.toHaveBeenCalled()
  })

  it('works for an unauthenticated request (this route does not require a session) without ever crashing the shadow seam', async () => {
    mockGetServerSession.mockResolvedValue(null)
    mockShouldRunSharedTradeShadowCompare.mockReturnValue(true)
    const res = await POST(makeRequest(VALID_BODY) as never)
    expect(res.status).toBe(200)
    expect(mockRunSharedTradeValueShadowCompare).toHaveBeenCalledTimes(1)
  })
})
