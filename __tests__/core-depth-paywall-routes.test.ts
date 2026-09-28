// @vitest-environment node
/**
 * The /core depth paywall at the ROUTES — where it actually has to hold, because every screen that
 * reads these is a browser component and would receive whatever the route sends.
 *
 * `resolveCoreDepth`/`resolveCorePaywall` are mocked here: their rule and the plan matrix are pinned in
 * core-depth-paywall.test.ts. What these pin is that each route asks, and what it withholds.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { decideCoreDepth, type CoreDepth } from '@/lib/core-app/coreDepthAccess'

const START = new Date('2026-10-15T04:00:00.000Z')
const lockedAccess = (d: CoreDepth) => decideCoreDepth(d, { live: true, startsAt: START, hasPlan: false })
const openAccess = (d: CoreDepth) => decideCoreDepth(d, { live: true, startsAt: START, hasPlan: true })

/** `locked` locks every depth; `lockedOnly` locks just the named ones (e.g. a War Room plan: trade depth locked, edge open). */
const depthState = vi.hoisted(() => ({ locked: false, lockedOnly: null as string[] | null }))
const isLocked = (d: CoreDepth) => depthState.locked || Boolean(depthState.lockedOnly?.includes(d))
const resolveCoreDepth = vi.hoisted(() => vi.fn())
const resolveCorePaywall = vi.hoisted(() => vi.fn())
vi.mock('@/lib/core-app/corePaywall', () => ({ resolveCoreDepth, resolveCorePaywall }))
const loadTradeEdge = vi.hoisted(() => vi.fn())
vi.mock('@/lib/competitive-edge/tradeEdgeLoader', () => ({ loadTradeEdge }))

const getServerSession = vi.hoisted(() => vi.fn())
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('server-only', () => ({}))

// ── /api/trade-value/analyze ────────────────────────────────────────────────────────────────
const analysis = vi.hoisted(() => ({ current: null as unknown }))
const buildTradeContextNotes = vi.hoisted(() => vi.fn())
vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage: () => (handler: unknown) => handler,
  logUsageEvent: vi.fn(async () => {}),
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: () => ({ success: true }),
  consumeRateLimit: () => ({ success: true, retryAfterSec: 0 }),
  buildRateLimit429: () => ({}),
  getClientIp: () => '127.0.0.1',
}))
vi.mock('@/lib/ai-protection/costGate', () => ({
  evaluateAiCostGate: vi.fn(async () => ({ ok: true, hasPlan: false, anonymous: false })),
}))
vi.mock('@/lib/trade-value-console/runTradeConsoleAnalysis', () => ({
  runTradeConsoleAnalysis: vi.fn(async () => analysis.current),
}))
vi.mock('@/lib/decision-os/trade/surfaceShadow', () => ({ recordTradeSurfaceShadow: vi.fn() }))
vi.mock('@/lib/decision-os/trade/canonicalVisibility', () => ({ toTradeCanonicalOpinion: () => null }))
vi.mock('@/lib/decision-os/trade/consoleShadowCompare', () => ({ compareConsoleVerdictWithCanonicalGrade: () => null }))
vi.mock('@/lib/decision-os/trade/enrichmentPort', () => ({ resolveTradeEnrichment: vi.fn(async () => ({ enrichment: {} })) }))
vi.mock('@/lib/trade-intel/tradeContextNotes', () => ({ buildTradeContextNotes }))

// ── /api/league/trade-finder ────────────────────────────────────────────────────────────────
const leagueFindFirst = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: (...a: unknown[]) => leagueFindFirst(...a) },
    userProfile: { findUnique: vi.fn(async () => null) },
  },
}))
vi.mock('@/lib/trade-intel/tradeFinderService', () => ({ getTradeFinder: vi.fn() }))

// ── /api/core/player-card ───────────────────────────────────────────────────────────────────
const getPlayerCard = vi.hoisted(() => vi.fn())
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/core-app/playerCard', () => ({ getPlayerCard }))
vi.mock('@/lib/core-app/playerLeagueImpact', () => ({ getPlayerLeagueImpact: vi.fn() }))

// ── /api/commissioner-os/reports/* ──────────────────────────────────────────────────────────
const resolveCommissionerOsDepth = vi.hoisted(() => vi.fn())
const readReportContent = vi.hoisted(() => vi.fn())
vi.mock('@/lib/commissioner-ui/commissionerOsDepth', () => ({ resolveCommissionerOsDepth }))
vi.mock('@/lib/commissioner-ui/resolveActiveLeagueId', () => ({ resolveActiveLeagueId: vi.fn(async () => 'L1') }))
vi.mock('@/lib/commissioner-ui/liveReadiness', () => ({ isLiveReady: vi.fn(async () => false) }))
vi.mock('@/lib/commissioner-reports/reportStore', () => ({ generateReport: vi.fn(), readReportContent }))

import { POST as analyzePOST } from '@/app/api/trade-value/analyze/route'
import { GET as finderGET } from '@/app/api/league/trade-finder/route'
import { GET as cardGET } from '@/app/api/core/player-card/route'
import { POST as reportPOST } from '@/app/api/commissioner-os/reports/generate/route'
import { GET as reportGET } from '@/app/api/commissioner-os/reports/[id]/download/route'

beforeEach(() => {
  depthState.locked = false
  depthState.lockedOnly = null
  resolveCoreDepth.mockImplementation(async (_u: unknown, d: CoreDepth) => (isLocked(d) ? lockedAccess(d) : openAccess(d)))
  resolveCorePaywall.mockImplementation(async () =>
    Object.fromEntries(
      (['player_depth', 'trade_depth', 'commissioner_depth', 'competitive_edge'] as CoreDepth[]).map((d) => [
        d,
        isLocked(d) ? lockedAccess(d) : openAccess(d),
      ]),
    ),
  )
  loadTradeEdge.mockReset()
  loadTradeEdge.mockResolvedValue({ available: true, data: { manager: { name: 'tashaR', teamExternalId: '3' }, facts: [] } })
  resolveCommissionerOsDepth.mockImplementation(async () =>
    depthState.locked ? lockedAccess('commissioner_depth') : openAccess('commissioner_depth'),
  )
  getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'u1@example.com' } })
  leagueFindFirst.mockReset()
  leagueFindFirst.mockResolvedValue(null)
  readReportContent.mockReset()
})

describe('/api/trade-value/analyze — the verdict is free, the breakdown is AF Pro', () => {
  beforeEach(() => {
    buildTradeContextNotes.mockResolvedValue({
      byeNotes: ['Both RBs share a week-7 bye.'],
      needNotes: ['You are thin at RB.'],
      leverageNotes: ['They need a QB.'],
      postureNotes: ['They are contending.'],
      pickNotes: ['That first is a late first.'],
      scaleNotes: ['12 teams, deep benches.'],
      formatNotes: ['Superflex: QBs price up.'],
    })
    analysis.current = {
      ok: true,
      effectiveSport: 'NFL',
      analysisMode: 'dynasty',
      fairnessScore: 58,
      confidenceScore: 40,
      percentDiff: 10,
      labels: { fairnessLabel: 'Slightly favours you', sideAdvantage: 'me' },
      // What the viewer gives is what the partner would receive: a WR and a pick; FAAB is not tracked.
      players: {
        give: [
          { name: 'A', position: 'WR' },
          { name: '2027 1st', position: 'PICK' },
          { name: 'FAAB $5', position: 'FAAB' },
        ],
        get: [{ name: 'B', position: 'RB' }],
      },
      tradeIntelligence: { why: 'the breakdown', whoWinsNow: 'you' },
      chimmyPayload: { tradeIntelligence: { why: 'the breakdown, again' } },
      opponentRosterTargets: [{ name: 'Counter target' }],
      summaryLine: 'You win now; they win later.',
      negotiationToolkit: { asks: [] },
      evaluation: { bullets: ['why'], sensitivity: 's' },
      drivers: { acceptBullets: [] },
      secondary: { contender: 1 },
    }
  })

  const post = async (extra: Record<string, unknown> = {}) => {
    const req = new Request('http://localhost/api/trade-value/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sportFilter: 'ALL',
        leagueId: 'l1',
        strategy: 'neutral',
        teamContext: 'my_team',
        sideGive: [{ kind: 'player', name: 'A' }],
        sideGet: [{ kind: 'player', name: 'B' }],
        ...extra,
      }),
    })
    const res = await (analyzePOST as unknown as (r: Request) => Promise<Response>)(req)
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }

  it('locked: every copy of the breakdown is gone — not just tradeIntelligence', async () => {
    depthState.locked = true
    const { status, body } = await post()
    expect(status).toBe(200)
    for (const k of [
      'tradeIntelligence', 'chimmyPayload', 'opponentRosterTargets', 'summaryLine', 'negotiationToolkit',
      'evaluation', 'drivers', 'secondary', 'needNotes', 'leverageNotes', 'postureNotes', 'pickNotes', 'scaleNotes',
    ]) {
      expect(body, k).not.toHaveProperty(k)
    }
    expect(JSON.stringify(body)).not.toContain('the breakdown')
    // One plan read for the whole response, with the email (admin and QA bypass).
    expect(resolveCorePaywall).toHaveBeenCalledWith('u1', { email: 'u1@example.com' })
  })

  it('locked: the verdict, the league rules and the bye facts are all still there', async () => {
    depthState.locked = true
    const { body } = await post()
    expect(body.fairnessScore).toBe(58)
    expect(body.labels).toMatchObject({ fairnessLabel: 'Slightly favours you' })
    expect(body.formatNotes).toEqual(['Superflex: QBs price up.'])
    expect(body.byeNotes).toEqual(['Both RBs share a week-7 bye.'])
    expect(body.depth).toMatchObject({ unlocked: false, planName: 'AF Pro' })
  })

  it('[control] open: the breakdown is sent', async () => {
    const { body } = await post()
    expect(body.tradeIntelligence).toEqual({ why: 'the breakdown', whoWinsNow: 'you' })
    expect(body.needNotes).toEqual(['You are thin at RB.'])
    expect(body.summaryLine).toBe('You win now; they win later.')
  })

  describe('Competitive Edge — its own depth (AF Pro and the War Room plan)', () => {
    const withPartner = { opponentTeamExternalId: '3' }

    it('open, with a partner: read for THIS deal — what the viewer gives is what the partner gets', async () => {
      const { body } = await post(withPartner)
      expect(loadTradeEdge).toHaveBeenCalledWith({
        leagueId: 'l1',
        userId: 'u1',
        opponentTeamExternalId: '3',
        deal: {
          theyGet: [{ kind: 'player', position: 'WR' }, { kind: 'pick' }],
          theySend: [{ kind: 'player', position: 'RB' }],
        },
      })
      expect(body.competitiveEdge).toMatchObject({ available: true, data: { manager: { name: 'tashaR' } } })
    })

    it('🛑 locked: the history is never read, and nothing is sent', async () => {
      depthState.lockedOnly = ['competitive_edge']
      const { body } = await post(withPartner)
      expect(loadTradeEdge).not.toHaveBeenCalled()
      expect(body).not.toHaveProperty('competitiveEdge')
    })

    it('🛑 a War Room plan (edge open, trade depth locked) keeps Competitive Edge while the breakdown goes', async () => {
      depthState.lockedOnly = ['trade_depth']
      const { body } = await post(withPartner)
      expect(body).not.toHaveProperty('tradeIntelligence')
      expect(body.competitiveEdge).toMatchObject({ available: true })
    })

    it('no partner chosen → nothing to read', async () => {
      const { body } = await post()
      expect(loadTradeEdge).not.toHaveBeenCalled()
      expect(body).not.toHaveProperty('competitiveEdge')
    })

    it('a failed read is stated, not a 500', async () => {
      loadTradeEdge.mockImplementation(async () => {
        throw new Error('db down')
      })
      const { status, body } = await post(withPartner)
      expect(status).toBe(200)
      expect(body.competitiveEdge).toEqual({ available: false, reason: 'Competitive Edge could not be read just now.' })
    })
  })
})

describe('/api/league/trade-finder — AF Pro, refused before any league read', () => {
  // A NextRequest: the route reads `req.nextUrl`.
  const get = () => finderGET(new NextRequest('http://localhost/api/league/trade-finder?leagueId=L1'))

  it('locked: 403 with the plan and the way to it, and the league is never read', async () => {
    depthState.locked = true
    const res = await get()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'feature_not_entitled', upgradePath: '/upgrade?plan=pro' })
    expect(leagueFindFirst).not.toHaveBeenCalled()
  })

  it('[control] open: it goes on to the league (absent here, so 404)', async () => {
    const res = await get()
    expect(res.status).toBe(404)
    expect(leagueFindFirst).toHaveBeenCalledTimes(1)
  })
})

describe('/api/core/player-card — market and history are AF Pro', () => {
  const CARD = {
    context: 'universal',
    player: { name: 'X' },
    market: { available: true, data: { value: 5000, delta: { change: 200, days: 14 } } },
    trades: { available: true, data: [{ transactionId: 't' }] },
    comps: { available: true, data: [{ sleeperId: '1', name: 'Y', value: 4900 }] },
    news: { available: true, data: [{ title: 'News stays' }] },
    injury: { available: false, reason: 'none' },
    insight: { headline: 'Up 200', detail: 'd', basis: 'b' },
    league: null,
  }
  const get = async () => {
    const res = await cardGET(new Request('http://localhost/api/core/player-card?sport=NFL&sleeperId=9'))
    return (await res.json()) as Record<string, any>
  }
  beforeEach(() => {
    getPlayerCard.mockReset()
    getPlayerCard.mockResolvedValue(CARD)
  })

  it('locked: no price move, trades, comps or insight — and the news stays', async () => {
    depthState.locked = true
    const body = await get()
    expect(body.market.data.delta).toBeNull()
    expect(body.market.data.value).toBe(5000)
    expect(body.trades).toEqual({ available: false, reason: 'Trade history is part of AF Pro.' })
    expect(body.comps.available).toBe(false)
    expect(body.insight).toBeNull()
    expect(body.news.data[0].title).toBe('News stays')
    expect(body.depth.unlocked).toBe(false)
  })

  it('[control] open: the card is sent whole', async () => {
    const body = await get()
    expect(body.market.data.delta).toEqual({ change: 200, days: 14 })
    expect(body.comps.available).toBe(true)
  })
})

describe('/api/commissioner-os/reports — AF Commissioner, after the commissioner check', () => {
  it('locked: generate and download both refuse with the plan', async () => {
    depthState.locked = true
    const gen = await reportPOST(new Request('http://localhost/x', { method: 'POST', body: '{}' }))
    expect(gen.status).toBe(403)
    expect(await gen.json()).toMatchObject({ code: 'feature_not_entitled', upgradePath: '/upgrade?plan=commissioner' })
    const dl = await reportGET(new Request('http://localhost/x'), { params: Promise.resolve({ id: 'r1' }) })
    expect(dl.status).toBe(403)
    expect(readReportContent).not.toHaveBeenCalled()
  })

  it('[control] open: they go on to the environment check (off here, so 409)', async () => {
    const gen = await reportPOST(new Request('http://localhost/x', { method: 'POST', body: '{}' }))
    expect(gen.status).toBe(409)
    const dl = await reportGET(new Request('http://localhost/x'), { params: Promise.resolve({ id: 'r1' }) })
    expect(dl.status).toBe(409)
  })
})
