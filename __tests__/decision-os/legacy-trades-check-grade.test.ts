/**
 * `/api/legacy/trades/check` grades completed trades with the ONE engine (Phase 4), and Chimmy's auto
 * trade evaluation shows the viewer's letter from it. Before: a GPT letter from player names alone,
 * turned into a "Trade score /100" and shown from the SENDER's side to the receiver.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  identity: { sleeperUsername: 'guap', actorId: 'af_user_1', source: 'session' as 'session' | 'guest' },
  evaluateTrade: vi.fn(),
  explainTrade: vi.fn(),
  resolveEvaluationLeagueId: vi.fn(),
  existing: null as null | Record<string, unknown>,
  upsert: vi.fn(),
  transactions: [] as unknown[],
}))

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (fn: unknown) => fn }))
vi.mock('@/lib/analytics-server', () => ({ trackLegacyToolUsage: vi.fn() }))
vi.mock('@/lib/legacy/requireLegacySleeperIdentity', () => ({
  requireLegacySleeperIdentity: vi.fn(async () => ({ ok: true, identity: h.identity })),
}))
vi.mock('@/lib/sleeper-client', () => ({
  getAllPlayers: vi.fn(async () => ({
    p1: { full_name: 'Star Runner' },
    p2: { full_name: 'Bench Wideout' },
  })),
  getLeagueUsers: vi.fn(async () => [
    { user_id: 'su_me', display_name: 'Me' },
    { user_id: 'su_them', display_name: 'Them' },
  ]),
  getLeagueRosters: vi.fn(async () => [
    { roster_id: 1, owner_id: 'su_them' },
    { roster_id: 2, owner_id: 'su_me' },
  ]),
  getLeagueTransactions: vi.fn(async () => h.transactions),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    legacyUser: {
      findUnique: vi.fn(async () => ({
        id: 'lu_1',
        sleeperUserId: 'su_me',
        leagues: [{ id: 'll_1', sleeperLeagueId: 'sl_1', name: 'Home League', season: 2026 }],
      })),
    },
    tradeNotification: {
      findUnique: vi.fn(async () => h.existing),
      upsert: h.upsert,
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    emailPreference: { findFirst: vi.fn(async () => null) },
  },
}))
vi.mock('@/lib/decision-os/trade/evaluateTrade', () => ({ evaluateTrade: h.evaluateTrade }))
vi.mock('@/lib/decision-os/trade/explainTrade', () => ({ explainTrade: h.explainTrade }))
vi.mock('@/lib/decision-os/trade/evaluationLeague', () => ({
  resolveEvaluationLeagueId: h.resolveEvaluationLeagueId,
  NOT_YOUR_LEAGUE_REASON: 'not your league',
}))

import { POST } from '@/server/api-route-modules/legacy/trades/check/route'
import { isEngineAnalysis, shownTradeGrade } from '@/lib/decision-os/trade/legacyTradeNotificationGrade'
import { pollIncomingTradeEvalEvents } from '@/lib/chimmy-chat/autoTradeEval'

const GRADED = {
  graded: true,
  letter: 'F',
  partnerLetter: 'A',
  label: 'Major win (opponent)',
}

function post() {
  return POST(new Request('http://localhost/api/legacy/trades/check', {
    method: 'POST',
    body: JSON.stringify({ sleeper_username: 'guap' }),
  }) as never) as Promise<Response>
}

beforeEach(() => {
  vi.clearAllMocks()
  h.identity = { sleeperUsername: 'guap', actorId: 'af_user_1', source: 'session' }
  h.existing = null
  // Roster 1 (Them) sends Star Runner and a 2027 1st; roster 2 (Me) sends Bench Wideout.
  h.transactions = [{
    transaction_id: 'tx_1',
    type: 'trade',
    status: 'complete',
    roster_ids: [1, 2],
    adds: { p1: 2, p2: 1 },
    draft_picks: [{ season: '2027', round: 1, roster_id: 1, previous_owner_id: 1, owner_id: 2 }],
    created: 1_700_000_000_000,
  }]
  h.resolveEvaluationLeagueId.mockResolvedValue('af_league_1')
  h.evaluateTrade.mockResolvedValue({ receiptId: 'rcpt_1', grade: GRADED })
  h.explainTrade.mockResolvedValue({
    source: 'template',
    verdict: { headline: 'Them gets an F grade: decline.', reasons: [{ text: 'r1' }, { text: 'r2' }], risks: ['x'] },
  })
  h.upsert.mockImplementation(async (args: { create: Record<string, unknown> }) => ({ id: 'tn_1', createdAt: new Date(0), ...args.create }))
})

describe('/api/legacy/trades/check — the one engine grades completed trades', () => {
  it('grades from the SENDER (first roster) side on the viewer’s own league, and stores the engine analysis', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(h.resolveEvaluationLeagueId).toHaveBeenCalledWith({ suppliedLeagueId: 'sl_1', userId: 'af_user_1' })
    const input = h.evaluateTrade.mock.calls[0]![0]
    expect(input).toMatchObject({
      surface: 'legacy-trades-check',
      leagueId: 'af_league_1',
      viewerSide: false,
      give: { assets: [{ kind: 'player', name: 'Star Runner' }, { kind: 'pick', year: 2027, round: 1 }] },
      get: { assets: [{ kind: 'player', name: 'Bench Wideout' }] },
    })
    const stored = h.upsert.mock.calls[0]![0].create
    expect(stored).toMatchObject({ aiGrade: 'F', aiVerdict: 'Strongly favors Me' })
    expect(isEngineAnalysis(stored.aiAnalysis)).toBe(true)
    expect(stored.aiAnalysis).toMatchObject({ grade: 'F', partnerGrade: 'A', receiptId: 'rcpt_1', expertAnalysis: 'Them gets an F grade: decline.' })
  })

  it('a guest session has no AllFantasy user: the grade is WITHHELD, never guessed', async () => {
    h.identity = { sleeperUsername: 'guap', actorId: 'guest:lu_1', source: 'guest' }
    h.resolveEvaluationLeagueId.mockResolvedValue(null)
    h.evaluateTrade.mockImplementation(async (_input: unknown, deps: { grade?: () => Promise<unknown> }) => ({
      receiptId: null,
      grade: deps.grade ? await deps.grade() : GRADED,
    }))
    await post()
    expect(h.resolveEvaluationLeagueId).toHaveBeenCalledWith({ suppliedLeagueId: 'sl_1', userId: null })
    const stored = h.upsert.mock.calls[0]![0].create
    expect(stored.aiGrade).toBeNull()
    expect(stored.aiAnalysis).toMatchObject({ grade: null, gradeWithheld: 'not your league' })
  })

  it('hides a pre-cutover GPT letter on an already-stored row', async () => {
    h.existing = {
      id: 'tn_old', leagueId: 'll_1', senderName: 'Them', receiverName: 'Me', senderRosterId: 1, receiverRosterId: 2,
      playersGiven: [], playersReceived: [], picksGiven: [], picksReceived: [],
      aiGrade: 'B+', aiVerdict: 'Fair', aiAnalysis: { grade: 'B+', verdict: 'Fair' },
      seenAt: null, status: 'analyzed', transactionId: 'tx_1', createdAt: new Date(0), sleeperCreatedAt: null,
    }
    const body = await (await post()).json()
    expect(h.evaluateTrade).not.toHaveBeenCalled()
    expect(body.trades[0]).toMatchObject({ aiGrade: null, aiVerdict: null, aiAnalysis: null })
  })
})

describe('shownTradeGrade', () => {
  it('passes an engine analysis through and blanks anything else', () => {
    const engine = { engine: 'trade-eval-v1', grade: 'C' }
    expect(shownTradeGrade({ aiGrade: 'C', aiVerdict: 'Fair', aiAnalysis: engine })).toMatchObject({ aiGrade: 'C' })
    expect(shownTradeGrade({ aiGrade: 'A-', aiVerdict: 'x', aiAnalysis: { grade: 'A-' } })).toEqual({ aiGrade: null, aiVerdict: null, aiAnalysis: null })
    expect(shownTradeGrade({ aiGrade: 'A-', aiVerdict: 'x', aiAnalysis: null }).aiGrade).toBeNull()
  })
})

describe("Chimmy's auto trade evaluation", () => {
  const poll = async (row: Record<string, unknown>) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ trades: [{ isNew: true, tradeDirection: 'incoming', transactionId: 'tx', leagueName: 'Home', ...row }] }))))
    const events = await pollIncomingTradeEvalEvents('guap')
    vi.unstubAllGlobals()
    return events[0]!.message
  }

  it("shows the RECEIVER's letter on an incoming offer — the mirror, not the sender's", async () => {
    const msg = await poll({ aiGrade: 'F', aiAnalysis: { grade: 'F', partnerGrade: 'A', expertAnalysis: 'Them gets an F grade: decline.' } })
    expect(msg).toContain('Your grade: A')
    expect(msg).not.toContain('Your grade: F')
  })

  it('never invents a numeric score', async () => {
    const msg = await poll({ aiGrade: 'C', aiAnalysis: { grade: 'C', partnerGrade: 'C' } })
    expect(msg).not.toMatch(/\/100|Trade score/)
  })

  it('says why when the grade was withheld, and treats a pre-cutover letter as ungraded', async () => {
    expect(await poll({ aiGrade: null, aiAnalysis: { grade: null, partnerGrade: null, gradeWithheld: 'not your league' } })).toContain('Not graded: not your league')
    expect(await poll({ aiGrade: 'B+', aiAnalysis: null })).toContain("hasn't been graded yet")
  })
})
