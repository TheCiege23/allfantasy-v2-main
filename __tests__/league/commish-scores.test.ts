/**
 * Edit Matchup Scores. The contract that matters beyond "the number changed":
 *   - only completed regular-season weeks (week < currentWeek, below the playoffs);
 *   - edited rows are `status: 'final'` (what keeps the score-sync cron off them) and stamped;
 *   - standings are rebuilt through the LATEST completed week — `updateStandings` is cumulative over
 *     `week <= throughWeek`, so rebuilding through the edited week would drop every later week.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = {
  id: string
  seasonId: string
  week: number
  isMedianMatchup: boolean
  homeRosterId: string
  awayRosterId: string | null
  homeScore: number
  awayScore: number
  status: string
  lineupSnapshots: Record<string, unknown> | null
}

const h = vi.hoisted(() => {
  const state = {
    role: 'commissioner' as string | null,
    season: { id: 'S1', season: 2026, currentWeek: 6, playoffStartWeek: 15 },
    rows: [] as Row[],
    standingsCalls: [] as Array<[string, number]>,
    audit: [] as Array<Record<string, unknown>>,
  }
  const prisma = {
    league: { findUnique: vi.fn(async () => ({ season: 2026 })) },
    redraftSeason: { findFirst: vi.fn(async () => ({ ...state.season })) },
    redraftMatchup: {
      findMany: vi.fn(async ({ where }: { where: { week: number; isMedianMatchup: boolean } }) =>
        state.rows.filter((r) => r.week === where.week && r.isMedianMatchup === where.isMedianMatchup).map((r) => JSON.parse(JSON.stringify(r))),
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) =>
        Object.assign(state.rows.find((r) => r.id === where.id)!, JSON.parse(JSON.stringify(data))),
      ),
    },
    redraftRoster: {
      findMany: vi.fn(async () => [
        { id: 'A', teamName: 'Aces', ownerName: 'a', wins: 3, losses: 2, ties: 0 },
        { id: 'B', teamName: null, ownerName: 'Bee', wins: 2, losses: 3, ties: 0 },
        { id: 'C', teamName: 'Cee', ownerName: 'c', wins: 5, losses: 0, ties: 0 },
      ]),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  return { state, prisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u-co' } })) }))
vi.mock('@/lib/league/permissions', () => ({
  getLeagueRole: vi.fn(async () => h.state.role),
  isCommissionerRole: (r: string | null) => r === 'commissioner' || r === 'co_commissioner',
}))
vi.mock('@/lib/redraft/standingsEngine', () => ({
  updateStandings: vi.fn(async (seasonId: string, week: number) => {
    h.state.standingsCalls.push([seasonId, week])
    return { seasonId, week, rostersUpdated: 3, matchupsCounted: 9 }
  }),
}))
vi.mock('@/server/services/auditService', () => ({
  logAction: vi.fn(async (i: Record<string, unknown>) => {
    h.state.audit.push(i)
    return { id: 'a' }
  }),
}))

import { GET, PATCH, editableWeeks, parseScore } from '@/app/api/leagues/[leagueId]/commish-scores/handler'

const ctx = { params: { leagueId: 'L1' } }
const req = (method: string, body?: unknown, qs = '') =>
  new Request(`http://localhost/api/leagues/L1/commish-scores${qs}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }) as never

beforeEach(() => {
  h.state.role = 'co_commissioner'
  h.state.season = { id: 'S1', season: 2026, currentWeek: 6, playoffStartWeek: 15 }
  h.state.standingsCalls = []
  h.state.audit = []
  h.state.rows = [
    { id: 'm1', seasonId: 'S1', week: 5, isMedianMatchup: false, homeRosterId: 'A', awayRosterId: 'B', homeScore: 110.5, awayScore: 99, status: 'final', lineupSnapshots: { redraftScoring: { isComplete: true } } },
    { id: 'm2', seasonId: 'S1', week: 5, isMedianMatchup: false, homeRosterId: 'C', awayRosterId: null, homeScore: 120, awayScore: 0, status: 'final', lineupSnapshots: null },
    { id: 'med', seasonId: 'S1', week: 5, isMedianMatchup: true, homeRosterId: 'A', awayRosterId: null, homeScore: 0, awayScore: 0, status: 'final', lineupSnapshots: null },
    { id: 'm9', seasonId: 'S1', week: 6, isMedianMatchup: false, homeRosterId: 'A', awayRosterId: 'C', homeScore: 40, awayScore: 30, status: 'active', lineupSnapshots: null },
  ]
})

describe('which weeks can be edited', () => {
  it('only completed regular-season weeks, newest first', () => {
    expect(editableWeeks(6, 15)).toEqual([5, 4, 3, 2, 1])
    expect(editableWeeks(17, 15)).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(editableWeeks(1, 15)).toEqual([])
    expect(editableWeeks(0, null)).toEqual([])
  })
  it('scores are 0..9999, two decimals', () => {
    expect(parseScore('451.955')).toBe(451.96)
    expect(parseScore(0)).toBe(0)
    expect([parseScore(-1), parseScore(10000), parseScore('x'), parseScore('')]).toEqual([null, null, null, null])
  })
})

describe('GET', () => {
  it('defaults to the latest completed week, hides median rows, names teams without email', async () => {
    const body = await (await GET(req('GET'), ctx)).json()
    expect(body.week).toBe(5)
    expect(body.matchups.map((m: { matchupId: string }) => m.matchupId)).toEqual(['m1', 'm2'])
    expect(body.matchups[0].away).toEqual({ rosterId: 'B', name: 'Bee', record: '2-3' })
    expect(body.matchups[1].away).toBeNull()
  })
  it('refuses a member', async () => {
    h.state.role = 'member'
    expect((await GET(req('GET'), ctx)).status).toBe(403)
  })
})

describe('PATCH', () => {
  it('writes the scores as final, stamps the edit, and rebuilds standings through the latest completed week', async () => {
    h.state.season.currentWeek = 9 // editing week 5 while weeks 6-8 are complete
    const res = await PATCH(req('PATCH', { week: 5, scores: [{ matchupId: 'm1', homeScore: 90, awayScore: '101.25' }] }), ctx)
    expect(res.status).toBe(200)
    const m1 = h.state.rows.find((r) => r.id === 'm1')!
    expect(m1).toMatchObject({ homeScore: 90, awayScore: 101.25, status: 'final' })
    expect(m1.lineupSnapshots).toMatchObject({
      redraftScoring: { isComplete: true }, // existing snapshot kept
      commissionerEdit: { by: 'u-co', before: { homeScore: 110.5, awayScore: 99, status: 'final' } },
    })
    expect(h.state.standingsCalls).toEqual([['S1', 8]]) // NOT 5 — that would drop weeks 6-8
    expect(h.state.audit[0]).toMatchObject({ actionType: 'commish_edit_matchup_scores', afterState: [{ matchupId: 'm1', homeScore: 90, awayScore: 101.25 }] })
  })

  it('edits a scored bye (it plays the median) without an away score', async () => {
    const res = await PATCH(req('PATCH', { week: 5, scores: [{ matchupId: 'm2', homeScore: 80 }] }), ctx)
    expect(res.status).toBe(200)
    expect(h.state.rows.find((r) => r.id === 'm2')!.homeScore).toBe(80)
  })

  it.each([
    [{ week: 6, scores: [{ matchupId: 'm9', homeScore: 1, awayScore: 1 }] }, 'current week'],
    [{ week: 15, scores: [{ matchupId: 'm1', homeScore: 1, awayScore: 1 }] }, 'playoff week'],
    [{ week: 5, scores: [{ matchupId: 'm9', homeScore: 1, awayScore: 1 }] }, 'matchup from another week'],
    [{ week: 5, scores: [{ matchupId: 'med', homeScore: 1 }] }, 'median row'],
    [{ week: 5, scores: [{ matchupId: 'm1', homeScore: 1 }] }, 'missing away score'],
    [{ week: 5, scores: [{ matchupId: 'm1', homeScore: -5, awayScore: 1 }] }, 'negative score'],
  ])('refuses %j (%s) and writes nothing', async (body) => {
    h.state.season.currentWeek = 6
    const before = JSON.stringify(h.state.rows)
    expect((await PATCH(req('PATCH', body), ctx)).status).toBe(400)
    expect(JSON.stringify(h.state.rows)).toBe(before)
    expect(h.state.standingsCalls).toEqual([])
  })
})
