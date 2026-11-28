// @vitest-environment node
/**
 * Partner Match (`/api/trade-finder/matchmaking`) takes its VERDICT from the one grader (2026-11-26).
 *
 * The offer skeleton is still GENERATED on the route's hybrid-valuation values — but the letter, the
 * "Fairness" chip, the accept estimate and the ORDER must come from `gradeDeal` on ONE
 * `createLeagueTradeGrader` for the viewer's league. Pinned here by making the grade and the finder's
 * own values disagree: two partners whose offers are dead even on the finder's values, where the more
 * active partner ranks first on fit, and the grade says that partner's offer is lopsided.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (h: unknown) => h }))
vi.mock('@/lib/subscription/requireEntitlement', () => ({ requireEntitlement: vi.fn(async () => 'pro') }))
vi.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: () => ({ success: true, remaining: 9, retryAfterSec: 0 }),
  getClientIp: () => '127.0.0.1',
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'viewer-1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
const findFirst = vi.fn(async () => ({ id: 'af-league-1' }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findFirst: (...a: unknown[]) => findFirst(...(a as [])) } } }))
vi.mock('@vercel/functions', () => ({ waitUntil: () => undefined }))
vi.mock('@/lib/trade-pre-analysis', () => ({
  getPreAnalysisStatus: vi.fn(async () => ({ status: 'missing' })),
  runPreAnalysis: vi.fn(async () => undefined),
}))
vi.mock('@/lib/player-media', () => ({ attachPlayerMediaBatch: vi.fn(async () => new Map()) }))
vi.mock('@/lib/fantasycalc', () => ({}))
vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst: vi.fn(async () => []) }))
vi.mock('@/lib/values/leagueValuePatch', () => ({ resolveLeagueValuePatch: vi.fn(async () => ({})) }))

/** The finder's OWN values — generation only. Both offers are User WR2 (6500) for a partner's RB1 (6000): identical on these. */
const FINDER_VALUE: Record<string, number> = {
  'User QB': 6000, 'User RB': 3000, 'User WR1': 7000, 'User WR2': 6500, 'User TE': 4000,
  'Bench WR': 5000,
  'P2 QB': 6000, 'P2 RB1': 6000, 'P2 RB2': 5800, 'P2 WR1': 3000, 'P2 TE': 3000, 'Bijan Robinson': 5000,
  'P3 QB': 6000, 'P3 RB1': 6000, 'P3 RB2': 5800, 'P3 WR1': 3000, 'P3 TE': 3000, 'Jahmyr Gibbs': 5000,
}
vi.mock('@/lib/hybrid-valuation', () => ({
  pricePlayer: vi.fn(async (name: string) => ({
    name,
    value: FINDER_VALUE[name] ?? 0,
    assetValue: { marketValue: FINDER_VALUE[name] ?? 0, impactValue: 0, vorpValue: 0, volatility: 0 },
  })),
}))
vi.mock('@/lib/trade-engine', () => ({
  convertSleeperToAssets: ({ rosters, fantasyCalcValues }: { rosters: Array<{ rosterId: number; players: Array<{ id: string; name: string; pos: string; slot: string }> }>; fantasyCalcValues: Record<string, { value: number }> }) =>
    Object.fromEntries(
      rosters.map((r) => [r.rosterId, r.players.map((p) => ({ id: p.id, type: 'PLAYER', name: p.name, pos: p.pos, slot: p.slot, value: fantasyCalcValues[p.name]?.value ?? 0 }))]),
    ),
}))

const PLAYERS: Record<string, { first_name: string; last_name: string; position: string; team: string }> = {}
const add = (id: string, name: string, position: string) => {
  const [first, ...rest] = name.split(' ')
  PLAYERS[id] = { first_name: first!, last_name: rest.join(' '), position, team: 'FA' }
  return id
}
const user = [add('u1', 'User QB', 'QB'), add('u2', 'User RB', 'RB'), add('u3', 'User WR1', 'WR'), add('u4', 'User WR2', 'WR'), add('u5', 'User TE', 'TE'), add('u6', 'Bench WR', 'WR')]
const p2 = [add('a1', 'P2 QB', 'QB'), add('a2', 'P2 RB1', 'RB'), add('a3', 'P2 RB2', 'RB'), add('a4', 'P2 WR1', 'WR'), add('a5', 'P2 TE', 'TE'), add('a6', 'Bijan Robinson', 'RB')]
const p3 = [add('b1', 'P3 QB', 'QB'), add('b2', 'P3 RB1', 'RB'), add('b3', 'P3 RB2', 'RB'), add('b4', 'P3 WR1', 'WR'), add('b5', 'P3 TE', 'TE'), add('b6', 'Jahmyr Gibbs', 'RB')]
const roster = (roster_id: number, owner_id: string, ids: string[]) => ({ roster_id, owner_id, players: ids, starters: ids.slice(0, 5), settings: { wins: 1, losses: 1, fpts: 100 } })

vi.mock('@/lib/sleeper-client', () => ({
  getLeagueInfo: vi.fn(async () => ({ name: 'Test League', sport: 'nfl', settings: { type: 2, num_teams: 3 }, roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'BN'], scoring_settings: { rec: 1 } })),
  getLeagueRosters: vi.fn(async () => [roster(1, 'owner-1', user), roster(2, 'owner-2', p2), roster(3, 'owner-3', p3)]),
  getLeagueUsers: vi.fn(async () => [
    { user_id: 'owner-1', username: 'me', display_name: 'Me' },
    { user_id: 'owner-2', username: 'active', display_name: 'Active Trader' },
    { user_id: 'owner-3', username: 'quiet', display_name: 'Quiet Trader' },
  ]),
  getPlayersBySport: vi.fn(async () => PLAYERS),
  // Roster 2 trades a lot, so it ranks FIRST on partner fit alone.
  getLeagueTransactions: vi.fn(async () => Array.from({ length: 6 }, () => ({ type: 'trade', roster_ids: [2, 9] }))),
}))

const createLeagueTradeGrader = vi.fn(async () => ({ leagueId: 'af-league-1' }))
const gradeDeal = vi.fn()
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', () => ({
  createLeagueTradeGrader: (...a: unknown[]) => createLeagueTradeGrader(...(a as [])),
  gradeDeal: (...a: unknown[]) => gradeDeal(...a),
}))

const graded = (letter: string, percentDiff: number, giveValue: number, getValue: number, getName: string) => ({
  graded: true, letter, partnerLetter: 'B', percentDiff, label: `label ${letter}`, giveValue, getValue,
  lines: [
    { side: 'give', name: 'User WR2', marketValue: giveValue, leagueValue: giveValue },
    { side: 'get', name: getName, marketValue: getValue, leagueValue: getValue },
  ],
})

async function post(body: Record<string, unknown> = {}) {
  const { POST } = await import('@/app/api/trade-finder/matchmaking/route')
  const req = new Request('http://localhost/api/trade-finder/matchmaking', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ leagueId: 'SL1', sleeperUser: { username: 'me', userId: 'owner-1' }, goal: 'rb_depth', maxResults: 5, ...body }),
  })
  const res = await (POST as (r: Request) => Promise<Response>)(req)
  return { status: res.status, body: (await res.json()) as any }
}

beforeEach(() => {
  gradeDeal.mockReset()
  createLeagueTradeGrader.mockClear()
  findFirst.mockClear()
})

describe('/api/trade-finder/matchmaking — the verdict is THE grade', () => {
  it('grades every offer with ONE grader for the viewer’s league, from the viewer’s side', async () => {
    gradeDeal.mockImplementation(async (_g: unknown, args: { get: { assets: Array<{ name: string }> } }) =>
      graded('B', 0, 5000, 5000, args.get.assets[0]!.name),
    )
    const { status, body } = await post()
    expect(status).toBe(200)
    expect(createLeagueTradeGrader).toHaveBeenCalledTimes(1)
    expect(createLeagueTradeGrader).toHaveBeenCalledWith({ leagueId: 'af-league-1', userId: 'viewer-1' })
    expect(findFirst.mock.calls[0]![0]).toMatchObject({ where: { platformLeagueId: 'SL1' } })
    expect(gradeDeal).toHaveBeenCalledTimes(2)
    for (const call of gradeDeal.mock.calls) {
      expect(call[0]).toEqual({ leagueId: 'af-league-1' })
      expect(call[1].viewerSide).toBe(true)
      expect(call[1].give.assets).toEqual([{ kind: 'player', name: 'User WR2', providerIdentity: { provider: 'sleeper', id: 'u4' } }])
    }
    expect(body.leagueGradeAvailable).toBe(true)
  })

  it('ranks, prices and estimates acceptance on THE grade, not the finder’s values', async () => {
    gradeDeal.mockImplementation(async (_g: unknown, args: { get: { assets: Array<{ name: string }> } }) =>
      args.get.assets[0]!.name === 'P2 RB1'
        ? graded('A', 40, 6500, 9100, 'P2 RB1') // lopsided on THE grade
        : graded('C', 0, 6500, 6500, 'P3 RB1'), // even on THE grade
    )
    const { body } = await post()
    const names = body.partners.map((p: { displayName: string }) => p.displayName)
    // On fit alone the active trader is first; on the grade's gap the even offer wins.
    expect(names).toEqual(['Quiet Trader', 'Active Trader'])
    const [quiet, active] = body.partners
    expect(active.matchScore).toBeGreaterThan(quiet.matchScore)
    expect(quiet.acceptEstimate).toBeGreaterThan(active.acceptEstimate)
    expect(quiet.acceptBasis).toBe('league_grade')

    expect(active.suggestedOffer.leagueGrade).toMatchObject({ graded: true, letter: 'A', percentDiff: 40, giveValue: 6500, getValue: 9100 })
    expect(active.suggestedOffer.fairnessPct).toBe(40) // the finder's own values said -8 (6000 for 6500)
    expect(active.suggestedOffer.partnerGives[0].value).toBe(9100) // the grade's league value, not the finder's 6000
    expect(quiet.suggestedOffer.fairnessPct).toBe(0)
  })

  it('a withheld grade is SHOWN as withheld: no fairness number, the reason kept, accept on fit only', async () => {
    gradeDeal.mockResolvedValue({ graded: false, reason: '1 asset has no value on this league’s chart', basis: null })
    const { body } = await post()
    expect(body.partners).toHaveLength(2)
    for (const p of body.partners) {
      expect(p.suggestedOffer.leagueGrade).toEqual({ graded: false, reason: '1 asset has no value on this league’s chart' })
      expect(p.suggestedOffer.fairnessPct).toBeNull()
      expect(p.acceptBasis).toBe('partner_fit_only')
      for (const a of [...p.suggestedOffer.userGives, ...p.suggestedOffer.partnerGives]) expect(a.value).toBe(0)
    }
  })

  it('no AF copy of the league: no grader, every offer says why, the partners still load', async () => {
    findFirst.mockResolvedValueOnce(null as never)
    gradeDeal.mockImplementation(async (g: unknown) =>
      g ? graded('A', 0, 1, 1, 'x') : { graded: false, reason: 'This league’s values could not be loaded just now.', basis: null },
    )
    const { status, body } = await post()
    expect(status).toBe(200)
    expect(createLeagueTradeGrader).not.toHaveBeenCalled()
    expect(body.leagueGradeAvailable).toBe(false)
    expect(body.partners.map((p: any) => p.suggestedOffer.leagueGrade.graded)).toEqual([false, false])
  })
})
