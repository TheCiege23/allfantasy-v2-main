/**
 * Redraft AF War Room — route-level integration/auth contract.
 *
 * Exercises the real route handlers (GET state + dynamic [action] POST) with the
 * data/auth/AI boundaries mocked, so we verify authorization, roster scoping,
 * action dispatch, missing-data passthrough, and graceful OpenAI degradation
 * WITHOUT a browser session or live DB. The deterministic engines run for real
 * against a fixture context.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  RedraftDataAvailability,
  RedraftPlayerFact,
  RedraftWarRoomContext,
} from '@/lib/redraft-war-room/types'

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  buildContext: vi.fn(),
  requireEntitlement: vi.fn(),
  openaiChatText: vi.fn(),
}))

vi.mock('@/lib/get-current-user', () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock('@/lib/redraft-war-room/redraftWarRoomContext', () => ({
  buildRedraftWarRoomContext: mocks.buildContext,
}))
vi.mock('@/lib/subscription/requireEntitlement', () => ({ requireEntitlement: mocks.requireEntitlement }))
vi.mock('@/lib/openai-client', () => ({ openaiChatText: mocks.openaiChatText }))

function player(p: Partial<RedraftPlayerFact> & { playerId: string; position: string }): RedraftPlayerFact {
  return {
    playerId: p.playerId,
    playerName: p.playerName ?? `Player ${p.playerId}`,
    position: p.position,
    team: p.team ?? 'TM',
    slotType: p.slotType ?? 'bench',
    isStarterSlot: p.isStarterSlot ?? p.slotType !== 'bench',
    injuryStatus: p.injuryStatus ?? null,
    byeWeek: p.byeWeek ?? null,
    weekProjection: p.weekProjection ?? null,
    seasonAvgActual: p.seasonAvgActual ?? null,
    adp: p.adp ?? null,
    hasNoValueSignal: p.weekProjection == null && p.seasonAvgActual == null && (p.adp ?? null) == null,
  }
}

const AVAIL: RedraftDataAvailability = {
  scoringRules: 'available',
  rosterRules: 'available',
  standings: 'available',
  schedule: 'available',
  playerStats: 'available',
  projections: 'available',
  injuries: 'available',
  news: 'missing',
  waiverPool: 'missing',
  tradeValues: 'available',
}

function makeContext(opts: { isCommissioner?: boolean } = {}): RedraftWarRoomContext {
  const team = (rosterId: string, isUser: boolean) => ({
    rosterId,
    ownerId: rosterId,
    ownerName: `Owner ${rosterId}`,
    teamName: `Team ${rosterId}`,
    wins: 3,
    losses: 2,
    ties: 0,
    pointsFor: 600,
    pointsAgainst: 560,
    streak: 'W1',
    playoffSeed: 4,
    faabBalance: 80,
    waiverPriority: 5,
    isEliminated: false,
    isUserTeam: isUser,
    players: [
      player({ playerId: `${rosterId}-rb1`, position: 'RB', slotType: 'RB', isStarterSlot: true, weekProjection: 12 }),
      player({ playerId: `${rosterId}-wr1`, position: 'WR', slotType: 'WR', isStarterSlot: true, weekProjection: 18 }),
      player({ playerId: `${rosterId}-wr2`, position: 'WR', slotType: 'bench', weekProjection: 9 }),
      player({ playerId: `${rosterId}-te1`, position: 'TE', slotType: 'TE', isStarterSlot: true, weekProjection: 8 }),
    ],
  })
  return {
    leagueId: 'lg1',
    leagueType: 'redraft',
    sport: 'NFL',
    season: 2026,
    currentWeek: 6,
    totalWeeks: 17,
    playoffStartWeek: 15,
    seasonStatus: 'active',
    scoring: { sport: 'NFL', scoringPreset: 'PPR', pointsPerReception: 1, superflex: false, tePremium: false, idp: false },
    roster: {
      totalStarterSlots: 5,
      benchSlots: 6,
      irSlots: 1,
      lineupSlots: [
        { slotName: 'QB', allowedPositions: ['QB'], starterCount: 1, isFlex: false, isSuperflex: false },
        { slotName: 'RB', allowedPositions: ['RB'], starterCount: 1, isFlex: false, isSuperflex: false },
        { slotName: 'WR', allowedPositions: ['WR'], starterCount: 2, isFlex: false, isSuperflex: false },
        { slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'], starterCount: 1, isFlex: true, isSuperflex: false },
      ],
      requiredByPosition: { QB: 1, RB: 1, WR: 3, TE: 1 },
    },
    waivers: { type: 'faab', faabBudget: 100 },
    userRosterId: 'r1',
    isCommissioner: opts.isCommissioner ?? false,
    teams: [team('r1', true), team('r2', false)],
    upcomingMatchup: null,
    recentMatchup: null,
    freeAgents: [],
    availability: AVAIL,
    freshness: { generatedAt: 'now', statsAsOf: null, projectionsAsOf: null, injuriesAsOf: null },
    missingDataFlags: ['Free-agent pool requires provider integration — specific add targets are unavailable.'],
    featureAvailability: { teamNeeds: true, lineup: true, waivers: false, tradeAnalyze: true, tradeFind: true },
  }
}

async function getState(leagueId = 'lg1') {
  const { GET } = await import('@/app/api/leagues/[leagueId]/redraft-war-room/handler')
  return GET(new Request('http://t/x') as never, { params: Promise.resolve({ leagueId }) })
}
async function postAction(action: string, body: Record<string, unknown>, leagueId = 'lg1') {
  const { POST } = await import('@/app/api/leagues/[leagueId]/redraft-war-room/[action]/route')
  return POST(
    new Request('http://t/x', { method: 'POST', body: JSON.stringify(body) }) as never,
    { params: Promise.resolve({ leagueId, action }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentUser.mockResolvedValue({ id: 'u1', email: null })
  mocks.buildContext.mockImplementation(async () => ({ ok: true, context: makeContext() }))
  mocks.requireEntitlement.mockResolvedValue('u1') // entitled by default
  mocks.openaiChatText.mockResolvedValue({ ok: true, text: 'Start your WR1.', model: 'm', baseUrl: 'b' })
})

describe('GET /redraft-war-room (state)', () => {
  it('401 when unauthenticated', async () => {
    mocks.getCurrentUser.mockResolvedValue(null)
    expect((await getState()).status).toBe(401)
  })

  it('propagates the builder forbidden status for non-members', async () => {
    mocks.buildContext.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    expect((await getState()).status).toBe(403)
  })

  it('member gets own roster but other teams have players stripped', async () => {
    const res = await getState()
    expect(res.status).toBe(200)
    const body = await res.json()
    const mine = body.context.teams.find((t: { rosterId: string }) => t.rosterId === 'r1')
    const other = body.context.teams.find((t: { rosterId: string }) => t.rosterId === 'r2')
    expect(mine.players.length).toBeGreaterThan(0)
    expect(other.players).toHaveLength(0)
    expect(body.needs).toBeTruthy()
    expect(body.needs.tradeTargetPositions).toContain('QB') // detected from fixture (no QB rostered)
  })

  it('commissioner sees league-wide rosters (other teams retain players)', async () => {
    mocks.buildContext.mockResolvedValue({ ok: true, context: makeContext({ isCommissioner: true }) })
    const body = await (await getState()).json()
    const other = body.context.teams.find((t: { rosterId: string }) => t.rosterId === 'r2')
    expect(other.players.length).toBeGreaterThan(0)
  })
})

describe('POST /redraft-war-room/[action]', () => {
  it('404 for an unknown action', async () => {
    expect((await postAction('frobnicate', {})).status).toBe(404)
  })

  it('waivers returns drop-side analysis + needs-provider flag (pool missing)', async () => {
    const body = await (await postAction('waivers', {})).json()
    expect(body.waivers.needsProviderIntegration).toBe(true)
    expect(body.waivers.recommendedDrops.length).toBeGreaterThan(0)
  })

  it('lineup returns suggested starters with confidence', async () => {
    const body = await (await postAction('lineup', {})).json()
    expect(body.lineup.suggestedStarters.length).toBeGreaterThan(0)
    expect(body.lineup.confidence).toBe('high')
  })

  it('trade-find returns partner fit', async () => {
    const body = await (await postAction('trade-find', {})).json()
    expect(body.tradeFinder).toBeTruthy()
    expect(Array.isArray(body.tradeFinder.targets)).toBe(true)
  })

  it('trade-analyze returns a verdict', async () => {
    const body = await (
      await postAction('trade-analyze', { outgoingPlayerIds: ['r1-wr2'], incomingPlayerIds: ['r2-rb1'] })
    ).json()
    expect(['accept', 'reject', 'neutral', 'needs_more_data']).toContain(body.tradeAnalysis.verdict)
  })

  it('member cannot target another roster (403)', async () => {
    expect((await postAction('lineup', { rosterId: 'r2' })).status).toBe(403)
  })

  it('commissioner may target another roster', async () => {
    mocks.buildContext.mockResolvedValue({ ok: true, context: makeContext({ isCommissioner: true }) })
    const res = await postAction('lineup', { rosterId: 'r2' })
    expect(res.status).toBe(200)
  })

  it('ask is gated by AF War Room entitlement (returns the gate Response)', async () => {
    mocks.requireEntitlement.mockResolvedValue(new Response('paywall', { status: 402 }))
    const res = await postAction('ask', { question: 'Who do I start?' })
    expect(res.status).toBe(402)
    expect(mocks.requireEntitlement).toHaveBeenCalledWith('war_room_draft_strategy')
  })

  it('ask requires a question', async () => {
    expect((await postAction('ask', {})).status).toBe(400)
  })

  it('ask returns the AI answer when available', async () => {
    const body = await (await postAction('ask', { question: 'Who do I start?' })).json()
    expect(body.aiUnavailable).toBe(false)
    expect(body.answer).toMatch(/start/i)
  })

  it('ask degrades gracefully (no crash) when OpenAI is unavailable', async () => {
    mocks.openaiChatText.mockResolvedValue({ ok: false, status: 503, details: 'no key', model: '', baseUrl: '' })
    const res = await postAction('ask', { question: 'Who do I start?' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.aiUnavailable).toBe(true)
    expect(body.answer).toBeNull()
    expect(body.grounding).toBeTruthy() // deterministic facts still returned
  })
})
