/**
 * Commish lineup editor. What matters beyond "the lineup changed":
 *   - the caller sends ids per section, and they must be exactly the team's players, each once — the
 *     older override took raw playerData and could name players the team does not have;
 *   - starters are positional, so a player must fit the slot, and an empty slot may only trail the
 *     last filled one (a hole would slide later starters into the wrong slots on save);
 *   - the write goes through the engine's commish override (which syncs scoring and skips locks);
 *   - commish or co-commish only; imported leagues and chopped teams refuse.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  role: 'co_commissioner' as string | null,
  platform: 'allfantasy',
  chopped: false,
  playerData: {} as Record<string, unknown>,
  forced: [] as Array<Record<string, any>>,
  forceResult: { ok: true } as { ok: true } | { ok: false; error: string; status?: number },
  variant: null as string | null,
  currentWeek: 7,
  assignments: [] as Array<{ section: string; slotIndex: number; playerId: string }>,
  matchupSnapshot: {} as Record<string, unknown>,
  weekWrites: [] as Array<Record<string, any>>,
  rescored: [] as string[],
  standings: [] as Array<[string, number]>,
}))

const template = {
  templateId: 't',
  sportType: 'NFL',
  name: 't',
  formatType: 'standard',
  slots: [
    { slotName: 'QB', allowedPositions: ['QB'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 1 },
    { slotName: 'RB', allowedPositions: ['RB'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 2 },
    { slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: true, slotOrder: 3 },
    { slotName: 'BENCH', allowedPositions: ['*'], starterCount: 0, benchCount: 4, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 4 },
    { slotName: 'IR', allowedPositions: ['*'], starterCount: 0, benchCount: 0, reserveCount: 1, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 5 },
  ],
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ platform: h.platform, sport: 'NFL', leagueVariant: h.variant, settings: { currentWeek: 7 }, season: 2026 })) },
    redraftSeason: { findFirst: vi.fn(async () => ({ id: 'S1', season: 2026, currentWeek: h.currentWeek, playoffStartWeek: 15 })) },
    redraftMatchup: {
      findMany: vi.fn(async () => [{ id: 'm5', homeRosterId: 'rA', awayRosterId: 'rB', homeScore: 90, awayScore: 95, lineupSnapshots: h.matchupSnapshot }]),
    },
    afRosterLineupAssignment: { findMany: vi.fn(async () => h.assignments) },
    roster: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'A' ? { id: 'A', playerData: JSON.parse(JSON.stringify(h.playerData)), redraftRosterId: 'rA' } : null,
      ),
      findMany: vi.fn(async () => [{ id: 'A' }, { id: 'B' }]),
    },
    redraftRosterPlayer: {
      findMany: vi.fn(async () => [
        { playerId: 'qb1', playerName: 'Quinn QB', position: 'QB', team: 'KC' },
        { playerId: 'rb1', playerName: 'Ray RB', position: 'RB', team: 'SF' },
        { playerId: 'wr1', playerName: 'Wade WR', position: 'WR', team: 'DAL' },
        { playerId: 'rb2', playerName: 'Rex RB', position: 'RB', team: 'NYJ' },
      ]),
    },
  },
}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u-co' } })) }))
vi.mock('@/lib/league/permissions', () => ({
  getLeagueRole: vi.fn(async () => h.role),
  isCommissionerRole: (r: string | null) => r === 'commissioner' || r === 'co_commissioner',
}))
vi.mock('@/lib/scoring-engine/resolveTeamLabels', () => ({ buildRosterLabelMap: vi.fn(async () => new Map([['A', 'Aces'], ['B', 'Bees']])) }))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: vi.fn(async () => template) }))
vi.mock('@/lib/sport-defaults/LeagueVariantRegistry', () => ({ getFormatTypeForVariant: () => 'standard' }))
vi.mock('@/lib/guillotine/guillotineGuard', () => ({ isRosterChopped: vi.fn(async () => h.chopped) }))
vi.mock('@/lib/roster-lineup-engine/lineupAssignmentSync', () => ({
  syncAfRosterLineupAssignments: vi.fn(async (input: Record<string, any>) => {
    h.weekWrites.push(input)
  }),
}))
vi.mock('@/lib/redraft/scoringEngine', () => ({
  updateMatchupScores: vi.fn(async (id: string) => {
    h.rescored.push(id)
    return { matchupId: id, homeScore: 101.5, awayScore: 95 }
  }),
}))
vi.mock('@/lib/redraft/standingsEngine', () => ({
  updateStandings: vi.fn(async (seasonId: string, week: number) => {
    h.standings.push([seasonId, week])
  }),
}))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn(async () => ({ id: 'a' })) }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/specialty-league/registry', () => ({ getSpecialtySpecByVariant: (v: string) => (v === 'guillotine' ? { id: 'guillotine' } : null) }))
vi.mock('@/lib/roster-lineup-engine/commissionerRosterOverride', () => ({
  commissionerForceRosterLineup: vi.fn(async (input: Record<string, unknown>) => {
    h.forced.push(input)
    if (h.forceResult.ok) h.playerData = input.nextPlayerData as Record<string, unknown>
    return h.forceResult
  }),
}))

import { validateCommishLineup } from '@/lib/league/commishLineupEdits'
import { fitsSlot } from '@/lib/league/lineup-expand-template'
import { GET, PUT, parseCommishLineup } from '@/app/api/leagues/[leagueId]/commish-lineup/handler'

const ctx = { params: { leagueId: 'L1' } }
const put = (body: unknown) =>
  PUT(new Request('http://localhost/x', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never, ctx)
const get = (qs = '') => GET(new Request(`http://localhost/x${qs}`) as never, ctx)

beforeEach(() => {
  h.variant = null
  h.currentWeek = 7
  h.assignments = []
  h.matchupSnapshot = {}
  h.weekWrites = []
  h.rescored = []
  h.standings = []
  h.role = 'co_commissioner'
  h.platform = 'allfantasy'
  h.chopped = false
  h.forced = []
  h.forceResult = { ok: true }
  h.playerData = {
    players: ['qb1', 'rb1', 'wr1', 'rb2'],
    starters: ['qb1', 'rb1', 'wr1'],
    lineup_sections: { starters: [{ id: 'qb1', name: 'Quinn QB', position: 'QB' }, 'rb1', 'wr1'], bench: ['rb2'], ir: [], taxi: [], devy: [] },
  }
})

describe('slot eligibility', () => {
  it('a player fits a slot that lists his position, a wildcard, or when his position is unknown', () => {
    expect(fitsSlot({ allowedPositions: ['RB', 'WR'] }, 'WR')).toBe(true)
    expect(fitsSlot({ allowedPositions: ['RB', 'WR'] }, 'QB')).toBe(false)
    expect(fitsSlot({ allowedPositions: ['*'] }, 'K')).toBe(true)
    expect(fitsSlot({ allowedPositions: ['QB'] }, null)).toBe(true)
  })
})

describe('validateCommishLineup', () => {
  const slots = [
    { label: 'QB', allowedPositions: ['QB'] },
    { label: 'RB', allowedPositions: ['RB'] },
    { label: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'] },
  ]
  const pos: Record<string, string> = { qb1: 'QB', rb1: 'RB', wr1: 'WR', rb2: 'RB' }
  const v = (lineup: Record<string, unknown>) =>
    validateCommishLineup({
      lineup: { starters: [], bench: [], ir: [], taxi: [], devy: [], ...lineup } as never,
      rosterIds: ['qb1', 'rb1', 'wr1', 'rb2'],
      slots,
      limits: { starters: 3, bench: 4, ir: 1, taxi: 0, devy: 0 },
      positionOf: (id) => pos[id] ?? null,
      nameOf: (id) => id,
    })

  it('accepts a full, legal lineup and a trailing empty slot', () => {
    expect(v({ starters: ['qb1', 'rb1', 'wr1'], bench: ['rb2'] })).toBeNull()
    expect(v({ starters: ['qb1', 'rb1', ''], bench: ['rb2'], ir: ['wr1'] })).toBeNull()
  })
  it.each([
    [{ starters: ['qb1', '', 'wr1'], bench: ['rb1', 'rb2'] }, /from the top/],
    [{ starters: ['rb1', 'qb1', 'wr1'], bench: ['rb2'] }, /cannot start at QB/],
    [{ starters: ['qb1', 'rb1', 'wr1'], bench: ['rb2', 'rb1'] }, /only one spot/],
    [{ starters: ['qb1', 'rb1', 'wr1'], bench: [] }, /needs a spot/],
    [{ starters: ['qb1', 'rb1', 'wr1'], bench: ['rb2', 'zz9'] }, /not on this team/],
    [{ starters: ['qb1', 'rb1', 'wr1'], taxi: ['rb2'] }, /no TAXI spots/],
    [{ starters: ['qb1', 'rb1', 'wr1', 'rb2'] }, /more starters than/],
  ])('refuses %j', (lineup, msg) => {
    expect(v(lineup)).toMatch(msg)
  })
})

describe('GET', () => {
  it('lists teams without a rosterId', async () => {
    expect((await (await get()).json()).teams).toEqual([{ rosterId: 'A', name: 'Aces' }, { rosterId: 'B', name: 'Bees' }])
  })
  it('returns slots, names from scoring rows, and the current lineup aligned to slots', async () => {
    const body = await (await get('?rosterId=A')).json()
    expect(body.week).toBe(7)
    expect(body.slots.map((s: { label: string }) => s.label)).toEqual(['QB', 'RB', 'FLEX'])
    expect(body.lineup).toEqual({ starters: ['qb1', 'rb1', 'wr1'], bench: ['rb2'], ir: [], taxi: [], devy: [] })
    expect(body.players.find((p: { id: string }) => p.id === 'wr1')).toEqual({ id: 'wr1', name: 'Wade WR', position: 'WR', team: 'DAL' })
  })
  it('a player the sections never mention lands on the bench', async () => {
    h.playerData = { players: ['qb1', 'rb1', 'wr1', 'rb2'], lineup_sections: { starters: ['qb1'], bench: [] } }
    const body = await (await get('?rosterId=A')).json()
    expect(body.lineup.starters).toEqual(['qb1', '', ''])
    expect(body.lineup.bench.sort()).toEqual(['rb1', 'rb2', 'wr1'])
  })
  it('refuses a member', async () => {
    h.role = 'member'
    expect((await get('?rosterId=A')).status).toBe(403)
  })
})

describe('PUT', () => {
  it('rebuilds the lineup server-side and saves it through the commish override', async () => {
    const res = await put({ rosterId: 'A', lineup: { starters: ['qb1', 'rb2', 'rb1'], bench: [], ir: ['wr1'] } })
    expect(res.status).toBe(200)
    expect(h.forced).toHaveLength(1)
    const f = h.forced[0]!
    expect(f).toMatchObject({ leagueId: 'L1', rosterId: 'A', commissionerUserId: 'u-co', week: 7, season: 2026 })
    expect(f.nextPlayerData.starters).toEqual(['qb1', 'rb2', 'rb1'])
    expect(f.nextPlayerData.reserve).toEqual(['wr1'])
    expect(f.nextPlayerData.lineup_sections.starters[0]).toMatchObject({ id: 'qb1', name: 'Quinn QB', position: 'QB', team: 'KC' })
    const body = await res.json()
    expect(body.lineup.ir).toEqual(['wr1'])
  })

  it.each([
    [{ starters: ['qb1', 'rb1', 'wr1'], bench: ['rb2', 'stranger'] }, 'a player from another team'],
    [{ starters: ['wr1', 'rb1', 'qb1'], bench: ['rb2'] }, 'an ineligible starter'],
    [{ starters: ['qb1', '', 'wr1'], bench: ['rb1', 'rb2'] }, 'a hole in the starters'],
  ])('refuses %j (%s) and writes nothing', async (lineup) => {
    expect((await put({ rosterId: 'A', lineup })).status).toBe(400)
    expect(h.forced).toEqual([])
  })

  it('imported leagues, chopped teams and members are refused', async () => {
    const ok = { rosterId: 'A', lineup: { starters: ['qb1', 'rb1', 'wr1'], bench: ['rb2'] } }
    h.platform = 'sleeper'
    expect((await put(ok)).status).toBe(409)
    h.platform = 'allfantasy'
    h.chopped = true
    expect((await put(ok)).status).toBe(409)
    h.chopped = false
    h.role = 'member'
    expect((await put(ok)).status).toBe(403)
    expect(h.forced).toEqual([])
  })

  it('passes the engine’s own refusal through', async () => {
    h.forceResult = { ok: false, error: 'BENCH has 5 players, max 4.', status: 400 }
    const res = await put({ rosterId: 'A', lineup: { starters: ['qb1', 'rb1', 'wr1'], bench: ['rb2'] } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/BENCH/)
  })

  it('parses only a well-formed body', () => {
    expect(parseCommishLineup({ rosterId: 'A', lineup: { starters: ['qb1', null], bench: [' rb2 ', ''] } })).toEqual({
      rosterId: 'A',
      lineup: { starters: ['qb1', ''], bench: ['rb2'], ir: [], taxi: [], devy: [] },
    })
    expect(parseCommishLineup({ rosterId: 'A', lineup: { bench: [] } })).toBeNull()
    expect(parseCommishLineup({ lineup: { starters: [] } })).toBeNull()
  })
})

describe('past weeks', () => {
  const getWeek = (week: number) => get(`?rosterId=A&week=${week}`)
  const putWeek = (week: number, lineup: Record<string, unknown>) => put({ rosterId: 'A', week, lineup })

  it('this-week view lists the completed weeks that can still change', async () => {
    const body = await (await get('?rosterId=A')).json()
    expect(body.pastWeeks).toEqual([6, 5, 4, 3, 2, 1])
  })

  it('loads the lineup saved for that week, ordered by slot', async () => {
    h.assignments = [
      { section: 'starters', slotIndex: 1, playerId: 'rb2' },
      { section: 'starters', slotIndex: 0, playerId: 'qb1' },
      { section: 'starters', slotIndex: 2, playerId: 'wr1' },
      { section: 'bench', slotIndex: 0, playerId: 'rb1' },
    ]
    const body = await (await getWeek(5)).json()
    expect(body).toMatchObject({ week: 5, savedForWeek: true, scoreEdited: false, matchup: { myScore: 90, theirScore: 95 } })
    expect(body.lineup).toEqual({ starters: ['qb1', 'rb2', 'wr1'], bench: ['rb1'], ir: [], taxi: [], devy: [] })
  })

  it('a week with no saved lineup starts from the current one, and says so', async () => {
    const body = await (await getWeek(5)).json()
    expect(body.savedForWeek).toBe(false)
    expect(body.lineup.starters).toEqual(['qb1', 'rb1', 'wr1'])
  })

  it('saving writes that week only, re-scores its matchup and rebuilds standings through the latest week', async () => {
    const res = await putWeek(5, { starters: ['qb1', 'rb2', 'wr1'], bench: ['rb1'] })
    expect(res.status).toBe(200)
    expect(h.forced).toEqual([]) // the CURRENT lineup is untouched
    expect(h.weekWrites).toHaveLength(1)
    expect(h.weekWrites[0]).toMatchObject({ leagueId: 'L1', rosterId: 'A', season: 2026, week: 5 })
    expect(h.weekWrites[0]!.playerData.starters).toEqual(['qb1', 'rb2', 'wr1'])
    expect(h.rescored).toEqual(['m5'])
    expect(h.standings).toEqual([['S1', 6]]) // cumulative: NOT 5
  })

  it.each([
    [7, 'the current week'],
    [15, 'a playoff week'],
  ])('refuses week %i (%s)', async (week) => {
    expect((await putWeek(week, { starters: ['qb1', 'rb1', 'wr1'], bench: ['rb2'] })).status).toBe(400)
    expect(h.weekWrites).toEqual([])
  })

  it('refuses a matchup whose score was set by hand, a specialty format, and an illegal lineup', async () => {
    h.matchupSnapshot = { commissionerEdit: { by: 'u' } }
    expect((await putWeek(5, { starters: ['qb1', 'rb1', 'wr1'], bench: ['rb2'] })).status).toBe(409)
    h.matchupSnapshot = {}
    h.variant = 'guillotine'
    expect((await putWeek(5, { starters: ['qb1', 'rb1', 'wr1'], bench: ['rb2'] })).status).toBe(409)
    h.variant = null
    expect((await putWeek(5, { starters: ['rb1', 'qb1', 'wr1'], bench: ['rb2'] })).status).toBe(400)
    expect(h.weekWrites).toEqual([])
    expect(h.rescored).toEqual([])
  })
})
