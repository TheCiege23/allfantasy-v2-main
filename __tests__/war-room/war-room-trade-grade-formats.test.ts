/**
 * @vitest-environment node
 *
 * The keeper, guillotine and best-ball War Rooms' trade analyzers show THE grade (2026-09-29), exactly
 * as redraft and dynasty have since 2026-09-28 — and a league that has switched trades off grades nothing.
 *
 * These call the real routes with the context builders, engines and the grader's pricing mocked, so what
 * is under test is the route's own wiring: which sides it resolves, from whose side, and what it returns.
 */
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  createGrader: vi.fn(),
  gradeDeal: vi.fn(),
  context: null as unknown,
  engineVerdict: { verdict: 'accept', valueDelta: 9, rosterFitDelta: 0, keeperImpact: [], riskFlags: [], explanationFacts: [], missingDataFlags: [] },
}))

vi.mock('@/lib/decision-os/trade/leagueTradeGrader', () => ({ createLeagueTradeGrader: h.createGrader, gradeDeal: h.gradeDeal }))
vi.mock('@/lib/get-current-user', () => ({ getCurrentUser: vi.fn(async () => ({ id: 'u1' })) }))
vi.mock('@/lib/decision-os/trade/warRoomShadow', () => ({ recordWarRoomTradeShadow: vi.fn() }))
vi.mock('@/lib/openai-client', () => ({ openaiChatText: vi.fn() }))
vi.mock('@/lib/subscription/requireEntitlement', () => ({ requireEntitlement: vi.fn() }))
vi.mock('@/lib/keeper-war-room/keeperWarRoomContext', () => ({ buildKeeperWarRoomContext: vi.fn(async () => ({ ok: true, context: h.context })) }))
vi.mock('@/lib/guillotine-war-room/guillotineWarRoomContext', () => ({ buildGuillotineWarRoomContext: vi.fn(async () => ({ ok: true, context: h.context })) }))
vi.mock('@/lib/best-ball-war-room/bestBallWarRoomContext', () => ({ buildBestBallWarRoomContext: vi.fn(async () => ({ ok: true, context: h.context })) }))
vi.mock('@/lib/keeper-war-room/keeperTradeEngine', () => ({ analyzeKeeperTrade: vi.fn(() => h.engineVerdict) }))
vi.mock('@/lib/guillotine-war-room/guillotineTradeEngine', () => ({ analyzeGuillotineTrade: vi.fn(() => h.engineVerdict) }))
vi.mock('@/lib/best-ball-war-room/bestBallTradeEngine', () => ({
  analyzeBestBallTrade: vi.fn(() => h.engineVerdict),
  findBestBallTradeTargets: vi.fn(),
}))

import { POST as keeperPOST } from '@/app/api/leagues/[leagueId]/keeper-war-room/[action]/route'
import { POST as guillotinePOST } from '@/app/api/leagues/[leagueId]/guillotine-war-room/[action]/route'
import { POST as bestBallPOST } from '@/app/api/leagues/[leagueId]/best-ball-war-room/[action]/route'
import { WAR_ROOM_TRADES_DISABLED_REASON, gradeWarRoomTrade } from '@/lib/decision-os/trade/warRoomTradeGrade'

const code = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

const GRADED = { graded: true, letter: 'D', partnerLetter: 'B', label: 'Slightly favors opponent', giveValue: 6100, getValue: 5200 }

function contextFor(tradesEnabled: boolean) {
  return {
    userRosterId: 'r1',
    isCommissioner: true,
    missingDataFlags: [],
    guillotine: { tradesEnabled },
    bestBall: { tradesEnabled },
    teams: [
      { rosterId: 'r1', players: [{ playerId: '6813', playerName: 'Travis Kelce' }] },
      { rosterId: 'r2', players: [{ playerId: '8148', playerName: "Ja'Marr Chase" }] },
    ],
  }
}

type Post = (req: never, ctx: { params: Promise<{ leagueId: string; action: string }> }) => Promise<Response>

async function analyze(post: Post, body: Record<string, unknown>) {
  const req = new Request('http://localhost/api/x', { method: 'POST', body: JSON.stringify(body) })
  const res = await post(req as never, { params: Promise.resolve({ leagueId: 'L1', action: 'trade-analyze' }) })
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

const ROUTES: ReadonlyArray<[string, Post, boolean]> = [
  ['keeper', keeperPOST as unknown as Post, false],
  ['guillotine', guillotinePOST as unknown as Post, true],
  ['best-ball', bestBallPOST as unknown as Post, true],
]

beforeEach(() => {
  h.context = contextFor(true)
  h.createGrader.mockReset().mockResolvedValue({ grader: true })
  h.gradeDeal.mockReset().mockResolvedValue(GRADED)
})

describe.each(ROUTES)('%s War Room trade-analyze', (_kind, post, canDisableTrades) => {
  it('returns THE grade beside the analysis, graded on the league’s grader from the viewer’s own side', async () => {
    const { status, json } = await analyze(post, { outgoingPlayerIds: ['6813'], incomingPlayerIds: ['8148'] })
    expect(status).toBe(200)
    expect(json.tradeGrade).toEqual(GRADED)
    expect(json.tradeAnalysis).toMatchObject({ verdict: 'accept' })
    expect(h.createGrader).toHaveBeenCalledWith({ leagueId: 'L1', userId: 'u1' })
    expect(h.gradeDeal.mock.calls[0]![1]).toMatchObject({
      give: { assets: [{ kind: 'player', playerId: '6813', name: 'Travis Kelce' }], unpriceable: [] },
      get: { assets: [{ kind: 'player', playerId: '8148', name: "Ja'Marr Chase" }], unpriceable: [] },
      viewerSide: true,
    })
  })

  it('a commissioner analysing another roster gets the chart, not their own need', async () => {
    await analyze(post, { rosterId: 'r2', outgoingPlayerIds: ['8148'], incomingPlayerIds: ['6813'] })
    expect(h.gradeDeal.mock.calls[0]![1]).toMatchObject({ viewerSide: false })
  })

  it('an id on no roster is named as unpriceable, never priced as zero', async () => {
    await analyze(post, { outgoingPlayerIds: ['6813'], incomingPlayerIds: ['ghost'] })
    expect(h.gradeDeal.mock.calls[0]![1]).toMatchObject({ get: { assets: [], unpriceable: ['an asset not on any roster (ghost)'] } })
  })

  if (canDisableTrades) {
    it('trades switched off: the grade is withheld and no grader is loaded', async () => {
      h.context = contextFor(false)
      const { json } = await analyze(post, { outgoingPlayerIds: ['6813'], incomingPlayerIds: ['8148'] })
      expect(json.tradeGrade).toEqual({ graded: false, reason: WAR_ROOM_TRADES_DISABLED_REASON })
      expect(h.createGrader).not.toHaveBeenCalled()
    })
  }
})

describe('gradeWarRoomTrade — tradesEnabled', () => {
  const side = (id: string, name: string) => ({ players: [{ playerId: id, name }], picks: [], unknown: [] })
  const args = { leagueId: 'L1', userId: 'u1', viewerSide: true, outgoing: side('6813', 'K'), incoming: side('8148', 'C') }

  it('false withholds before any grader; true or unset grades as before', async () => {
    expect(await gradeWarRoomTrade({ ...args, tradesEnabled: false })).toEqual({ graded: false, reason: WAR_ROOM_TRADES_DISABLED_REASON })
    expect(h.createGrader).not.toHaveBeenCalled()
    expect(await gradeWarRoomTrade({ ...args, tradesEnabled: true })).toEqual(GRADED)
    expect(await gradeWarRoomTrade(args)).toEqual(GRADED)
  })
})

describe('the three panels print the grade, never the engine’s verdict', () => {
  // Comments stripped, so a sentence ABOUT the old verdict cannot satisfy or break a check.
  const strip = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  it.each([
    ['keeper', 'app/league/[leagueId]/tabs/keeper/KeeperWarRoomPanel.tsx', 'lib/keeper-war-room/client.ts'],
    ['guillotine', 'app/league/[leagueId]/tabs/guillotine/GuillotineWarRoomPanel.tsx', 'lib/guillotine-war-room/client.ts'],
    ['best-ball', 'app/league/[leagueId]/tabs/best-ball/BestBallWarRoomPanel.tsx', 'lib/best-ball-war-room/client.ts'],
  ])('%s', (kind, panel, client) => {
    const src = strip(code(panel))
    expect(src).toMatch(new RegExp(`<WarRoomTradeGradeLine grade=\\{tradeGrade\\} testId="${kind}-war-room-trade-grade" />`))
    expect(src).toMatch(/setTradeGrade\(analyzed\.tradeGrade \?\? null\)/)
    // 🛑 No fallback either: the private verdict and its value delta are not on screen at all.
    expect(src).not.toMatch(/tradeAnalysis\.verdict/)
    expect(src).not.toMatch(/tradeAnalysis\.valueDelta/)
    expect(code(client)).toMatch(/tradeGrade\?: SuggestionGrade \| null/)
  })

  it('positive control: the verdict shape matches the line these panels printed', () => {
    expect(/tradeAnalysis\.verdict/.test("Verdict: {tradeAnalysis.verdict.replace(/_/g, ' ')}")).toBe(true)
  })
})
