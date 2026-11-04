/**
 * C2C campus scoring: the campus lineup a team starts each week, which college weeks count in an NFL
 * week (by calendar), and the campus points added to the team's pro score.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/merged-devy-c2c/C2CLeagueConfig', () => ({
  getC2CConfig: vi.fn(async () => ({ collegeActiveLineupSlots: { QB: 1, RB: 1, FLEX: 1 } })),
}))

import { cfbWeeksByNflWeek, nflWeekWindows, weekBoundaryBefore } from '@/lib/c2c/campusWeeks'
import {
  campusSeats,
  campusStarterIds,
  campusStartersAfterSave,
  isFootballC2CLeague,
  seatCampusPlayers,
  validateCampusLineup,
} from '@/lib/c2c/campusLineup'
import { checkCampusSave } from '@/lib/c2c/campusLineupCheck'
import { campusPointsForMatchup } from '@/lib/c2c/campusScoring'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { aggregateNcaafWeek } from '@/lib/scoring-runtime/ncaafStatNormalization'
import { buildPersistedRosterDataFromRosterState } from '@/lib/roster/buildPersistedRosterDataFromRosterState'
import { buildPlayerDataFromSections } from '@/lib/roster/LineupTemplateValidation'
import { slotTypeFor } from '@/lib/league-runtime/redraftSlotType'

const at = (iso: string) => new Date(iso)

describe('campus weeks — by calendar', () => {
  it('a week boundary is the Tuesday 08:00 UTC at or before the moment', () => {
    // Thu 2026-09-10 → Tue 2026-09-08 08:00Z
    expect(new Date(weekBoundaryBefore(at('2026-09-10T00:20:00Z').getTime())).toISOString()).toBe('2026-09-08T08:00:00.000Z')
    // Tuesday 07:59Z still belongs to the previous week (Monday night football in the west)
    expect(new Date(weekBoundaryBefore(at('2026-09-15T07:59:00Z').getTime())).toISOString()).toBe('2026-09-08T08:00:00.000Z')
    expect(new Date(weekBoundaryBefore(at('2026-09-15T08:00:00Z').getTime())).toISOString()).toBe('2026-09-15T08:00:00.000Z')
  })

  const nfl = [
    { week: 1, startTime: '2026-09-11T00:20:00Z' }, // Thu
    { week: 1, startTime: '2026-09-15T00:15:00Z' }, // Mon night
    { week: 2, startTime: '2026-09-18T00:15:00Z' },
    { week: 2, startTime: '2026-09-20T17:00:00Z' },
    { week: 3, startTime: '2026-09-27T17:00:00Z' },
  ]

  it('an NFL week runs from the Tuesday before its first game for seven days', () => {
    const w = nflWeekWindows(nfl).get(1)!
    expect(new Date(w.start).toISOString()).toBe('2026-09-08T08:00:00.000Z')
    expect(new Date(w.end).toISOString()).toBe('2026-09-15T08:00:00.000Z')
  })

  it('places each college week by its middle game, once; week 0/1 before the NFL opens count nowhere', () => {
    const cfb = [
      { week: 1, startTime: '2026-09-04T23:00:00Z' }, // before NFL week 1's window
      { week: 1, startTime: '2026-09-05T16:00:00Z' },
      { week: 2, startTime: '2026-09-12T16:00:00Z' },
      { week: 2, startTime: '2026-09-12T19:30:00Z' },
      { week: 2, startTime: '2026-09-13T00:00:00Z' },
      { week: 3, startTime: '2026-09-18T23:00:00Z' }, // Friday
      { week: 3, startTime: '2026-09-19T16:00:00Z' },
      { week: 3, startTime: '2026-09-20T00:00:00Z' },
      { week: 9, startTime: null },
    ]
    const map = cfbWeeksByNflWeek(nfl, cfb)
    expect(map.get(1)).toEqual([2])
    expect(map.get(2)).toEqual([3])
    expect(map.get(3)).toBeUndefined() // nothing scheduled: campus starters score 0 that week
    expect([...map.values()].flat()).not.toContain(1)
  })

  it('a college week opening with a late Monday game still counts in the week its Saturday falls in', () => {
    const withWeek4 = [...nfl, { week: 4, startTime: '2026-10-04T17:00:00Z' }]
    const cfb = [
      { week: 5, startTime: '2026-09-29T02:00:00Z' }, // Monday night, inside NFL week 3's window
      { week: 5, startTime: '2026-10-03T16:00:00Z' },
      { week: 5, startTime: '2026-10-03T19:30:00Z' },
    ]
    const map = cfbWeeksByNflWeek(withWeek4, cfb)
    expect(map.get(4)).toEqual([5])
    expect(map.get(3)).toBeUndefined()
  })
})

describe('campus lineup', () => {
  it('expands the configured slots into seats', () => {
    expect(campusSeats({ QB: 1, RB: 2, FLEX: 1, TE: 0 })).toEqual(['QB', 'RB', 'RB', 'FLEX'])
  })

  it('seats players by matching, so a WR in FLEX never blocks an RB that only FLEX could take', () => {
    const seats = campusSeats({ RB: 1, FLEX: 1 })
    expect(seatCampusPlayers(seats, ['WR', 'RB'])).toBe(true)
    expect(seatCampusPlayers(seats, ['RB', 'RB'])).toBe(true)
    expect(seatCampusPlayers(seats, ['WR', 'WR'])).toBe(false)
    expect(seatCampusPlayers(seats, ['QB'])).toBe(false)
    // FLEX listed first: a greedy fill puts the RB in FLEX and strands the WR
    expect(seatCampusPlayers(['FLEX', 'RB'], ['RB', 'WR'])).toBe(true)
  })

  const before = { lineup_sections: { devy: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }], starters: [{ id: 'p1' }] } }
  const after = (campus: string[]) => ({ lineup_sections: { ...before.lineup_sections, campus } })
  const pos: Record<string, string> = { c1: 'QB', c2: 'RB', c3: 'WR', p1: 'QB' }
  const check = (campus: string[], slots = { QB: 1, RB: 1, FLEX: 1 }) =>
    validateCampusLineup({ before, after: after(campus), slots, positionOf: (id) => pos[id], sport: 'football' }).map((i) => i.code)

  it('accepts college players that fit', () => {
    expect(check(['c1', 'c2', 'c3'])).toEqual([])
    expect(check([])).toEqual([])
  })

  it('refuses a pro player, too many players, and players that do not fit', () => {
    expect(check(['p1'])).toEqual(['campus_not_college'])
    expect(check(['c1', 'c2', 'c3'], { QB: 1, RB: 1 })).toEqual(['campus_too_many'])
    expect(check(['c1', 'c3'], { QB: 1, RB: 1 })).toEqual(['campus_ineligible'])
  })

  it('refuses outside football', () => {
    expect(validateCampusLineup({ before, after: after(['c1']), slots: {}, positionOf: () => 'G', sport: null }).map((i) => i.code)).toEqual(['campus_not_football'])
  })

  it('a campus starter is still a devy player to every generic reader', () => {
    expect(slotTypeFor(after(['c1']), 'c1', 'QB')).toBe('devy')
  })

  it('football C2C only', () => {
    expect(isFootballC2CLeague({ leagueVariant: 'c2c', sport: 'NFL' })).toBe(true)
    expect(isFootballC2CLeague({ leagueVariant: 'merged_devy_c2c', sport: 'NFL' })).toBe(true)
    expect(isFootballC2CLeague({ leagueVariant: 'c2c', sport: 'NBA' })).toBe(false)
    expect(isFootballC2CLeague({ leagueVariant: 'devy_dynasty', sport: 'NFL' })).toBe(false)
  })
})

describe('saving a lineup keeps the campus lineup', () => {
  const saved = {
    players: ['p1', 'c1', 'c2'],
    lineup_sections: { starters: [{ id: 'p1' }], bench: [], ir: [], taxi: [], devy: [{ id: 'c1' }, { id: 'c2' }], campus: ['c1'] },
  }
  const state = (extra: Record<string, unknown> = {}) => ({ starters: [{ id: 'p1' }], bench: [], ir: [], taxi: [], devy: [{ id: 'c1' }, { id: 'c2' }], ...extra })

  it('a pro lineup save (no campus list) keeps the campus starters', () => {
    expect(campusStarterIds(buildPersistedRosterDataFromRosterState(state(), saved))).toEqual(['c1'])
  })

  it('a campus save replaces them, and campus starters stay in the devy section', () => {
    const next = buildPersistedRosterDataFromRosterState(state({ campus: ['c2'] }), saved)
    expect(campusStarterIds(next)).toEqual(['c2'])
    expect(next.devy).toEqual(['c1', 'c2'])
  })

  it('a player who leaves the devy section leaves the campus lineup', () => {
    const promoted = buildPersistedRosterDataFromRosterState({ ...state(), starters: [{ id: 'p1' }, { id: 'c1' }], devy: [{ id: 'c2' }] }, saved)
    expect(campusStarterIds(promoted)).toEqual([])
    expect((promoted.lineup_sections as Record<string, unknown>).campus).toBeUndefined()
  })

  it('an AutoCoach / manual section rebuild keeps them too', () => {
    const rebuilt = buildPlayerDataFromSections(saved, {
      starters: [{ id: 'p1' }],
      bench: [],
      ir: [],
      taxi: [],
      devy: [{ id: 'c1' }, { id: 'c2' }],
    })
    expect(campusStarterIds(rebuilt)).toEqual(['c1'])
  })

  it('a sent campus list keeps only devy players', () => {
    expect(campusStartersAfterSave({ saved: {}, sent: ['c1', 'p1', 'c1'], devyIds: ['c1'] })).toEqual(['c1'])
  })
})

describe('checkCampusSave', () => {
  const db = {
    redraftRosterPlayer: {
      findMany: vi.fn(async () => [
        { playerId: 'c1', position: 'QB', playerName: 'Campus QB' },
        { playerId: 'c2', position: 'WR', playerName: 'Campus WR' },
      ]),
    },
  }
  const before = { lineup_sections: { devy: [{ id: 'c1' }, { id: 'c2' }] } }
  const after = (campus: string[]) => ({ lineup_sections: { devy: [{ id: 'c1' }, { id: 'c2' }], campus } })
  const league = { id: 'L1', platform: 'af', sport: 'NFL', leagueVariant: 'c2c' }

  it('checks a changed campus lineup against the league slots and roster positions', async () => {
    expect(await checkCampusSave(db as never, { league, redraftRosterId: 'R1', before, after: after(['c1', 'c2']) })).toEqual([])
    const issues = await checkCampusSave(db as never, {
      league,
      redraftRosterId: 'R1',
      before,
      after: { lineup_sections: { devy: [{ id: 'c1' }, { id: 'c2', position: 'RB' }], campus: ['c2', 'c1'] } },
    })
    expect(issues).toEqual([]) // order and client-sent positions do not matter; the roster row says WR → FLEX
  })

  it('refuses campus starters outside a native C2C league', async () => {
    const codes = async (l: typeof league) => (await checkCampusSave(db as never, { league: l, redraftRosterId: 'R1', before, after: after(['c1']) })).map((i) => i.code)
    expect(await codes({ ...league, leagueVariant: 'devy_dynasty' })).toEqual(['campus_not_c2c'])
    expect(await codes({ ...league, platform: 'sleeper' })).toEqual(['campus_not_c2c'])
    expect(await codes({ ...league, sport: 'NBA' })).toEqual(['campus_ineligible'])
  })

  it('checks the game lock when removing the last basketball campus starter', async () => {
    const result = await checkCampusSave(db as never, { league: { ...league, sport: 'NBA' }, redraftRosterId: 'R1', before: after(['c1']), after: after([]) })
    expect(result.map(issue => issue.code)).toContain('campus_ineligible')
  })

  it('does not re-judge an unchanged campus lineup', async () => {
    const same = { lineup_sections: { devy: [{ id: 'c1' }], campus: ['c1', 'c2'] } }
    expect(await checkCampusSave(db as never, { league, redraftRosterId: 'R1', before: same, after: same })).toEqual([])
  })
})

describe('campusPointsForMatchup', () => {
  const QB_LINE = { 'passing.YDS': 250, 'passing.TD': 2, 'rushing.YDS': 20 }
  const WR_LINE = { 'receiving.REC': 6, 'receiving.YDS': 90, 'receiving.TD': 1 }

  function makeDb(opts: { campusHome: string[]; campusAway?: string[]; cfbWeek?: number }) {
    const rows = [
      { rosterId: 'H', playerId: '111', position: 'QB' },
      { rosterId: 'H', playerId: '222', position: 'WR' },
      { rosterId: 'A', playerId: '333', position: 'WR' },
    ]
    const findManyStats = vi.fn(async ({ where }: { where: { weekOrRound: { in: number[] } } }) =>
      [
        { playerId: '111', weekOrRound: 2, normalizedStatMap: QB_LINE },
        { playerId: '222', weekOrRound: 2, normalizedStatMap: WR_LINE },
        { playerId: '333', weekOrRound: 2, normalizedStatMap: WR_LINE },
        { playerId: '111', weekOrRound: 5, normalizedStatMap: QB_LINE },
      ].filter((r) => where.weekOrRound.in.includes(r.weekOrRound)),
    )
    return {
      findManyStats,
      db: {
        roster: {
          findMany: vi.fn(async () => [
            { redraftRosterId: 'H', playerData: { lineup_sections: { campus: opts.campusHome } } },
            { redraftRosterId: 'A', playerData: { lineup_sections: { campus: opts.campusAway ?? [] } } },
          ]),
        },
        redraftRosterPlayer: { findMany: vi.fn(async () => rows) },
        playerGameStat: { findMany: findManyStats },
        sportsGame: {
          findMany: vi.fn(async ({ where }: { where: { sport: unknown } }) =>
            where.sport === 'NCAAF'
              ? [{ week: opts.cfbWeek ?? 2, startTime: '2026-09-12T16:00:00Z' }]
              : [{ week: 1, startTime: '2026-09-11T00:20:00Z' }],
          ),
        },
        sportsPlayer: { findMany: vi.fn(async ({ where }: { where: { externalId: { in: string[] } } }) => where.externalId.in.map((externalId) => ({ externalId }))) },
        playerIdentityMap: { findMany: vi.fn(async () => []) },
      },
    }
  }

  const scorer = buildLeagueStatScorer({ sport: 'NCAAF', settings: null })!
  const pts = (line: Record<string, number>, position: string) => Math.round(scorer(aggregateNcaafWeek([line]).stats, position) * 100) / 100

  it('scores each team’s campus starters from the college week inside this NFL week', async () => {
    const { db, findManyStats } = makeDb({ campusHome: ['111', '222'], campusAway: ['333'] })
    const out = await campusPointsForMatchup(db as never, { season: 2026, nflWeek: 1, homeRosterId: 'H', awayRosterId: 'A' })
    expect(out?.cfbWeeks).toEqual([2])
    expect(pts(QB_LINE, 'QB')).toBeGreaterThan(0)
    expect(out?.home.points).toBe(Math.round((pts(QB_LINE, 'QB') + pts(WR_LINE, 'WR')) * 100) / 100)
    expect(out?.away.points).toBe(pts(WR_LINE, 'WR'))
    expect(findManyStats.mock.calls[0][0].where.weekOrRound.in).toEqual([2]) // week 5 is never read
  })

  it('null when neither team starts a college player — the league scores as before', async () => {
    const { db } = makeDb({ campusHome: [] })
    expect(await campusPointsForMatchup(db as never, { season: 2026, nflWeek: 1, homeRosterId: 'H', awayRosterId: 'A' })).toBeNull()
  })

  it('after the college season, campus starters score 0 and the pro lineup decides', async () => {
    const { db, findManyStats } = makeDb({ campusHome: ['111'] })
    const out = await campusPointsForMatchup(db as never, { season: 2026, nflWeek: 9, homeRosterId: 'H', awayRosterId: 'A' })
    expect(out).toEqual({ cfbWeeks: [], home: { points: 0, players: [{ playerId: '111', points: 0 }] }, away: { points: 0, players: [] } })
    expect(findManyStats).not.toHaveBeenCalled()
  })

  it('a campus id no longer on the team scores nothing', async () => {
    const { db } = makeDb({ campusHome: ['111', '999'] })
    const out = await campusPointsForMatchup(db as never, { season: 2026, nflWeek: 1, homeRosterId: 'H', awayRosterId: 'A' })
    expect(out?.home.players.map((p) => p.playerId)).toEqual(['111'])
  })
})
