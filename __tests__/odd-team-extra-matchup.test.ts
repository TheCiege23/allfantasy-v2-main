import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The extra matchup an odd-team league plays instead of the bye (AF Commissioner).
 * Opponent selection, both scoring options, the idempotent week-open assignment, the settings gate.
 */

const h = vi.hoisted(() => ({
  hasPlan: false,
  db: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    userProfile: { findFirst: vi.fn() },
    leagueSettings: { upsert: vi.fn() },
    redraftSeason: { findFirst: vi.fn(), findUnique: vi.fn() },
    redraftPlayoffRound: { findFirst: vi.fn() },
    redraftRoster: { findMany: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    redraftMatchup: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    teamWeekResult: { findMany: vi.fn() },
    roster: { findMany: vi.fn() },
    leagueTeam: { updateMany: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.resolveForUser = vi.fn(async () => ({ hasAccess: h.hasPlan }))
  }),
}))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: vi.fn(async () => undefined) }))
vi.mock('@/lib/league/league-settings-draft-sync', () => ({ syncDraftSessionFromLeagueSettings: vi.fn() }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateDraftRoundsFitRoster: vi.fn() }))
vi.mock('@/lib/league/commissioner-settings-derived-sync', () => ({ syncCommissionerDerivedLeagueState: vi.fn() }))
vi.mock('@/server/services/commissionerService', () => ({ assertSettingsEditAllowed: vi.fn() }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn(async () => undefined) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn() }))
vi.mock('@/lib/commissioner/CommissionerChangeNotifier', () => ({ notifyCommissionerChange: vi.fn(async () => undefined) }))

import {
  EXTRA_MATCHUP_SETTINGS_KEY,
  extraMatchupResults,
  parseExtraMatchupSettings,
  pickExtraMatchupOpponent,
  readExtraMatchupSettings,
} from '@/lib/redraft/oddTeamExtraMatchupRules'
import { assignExtraMatchupForWeek, readExtraMatchupView } from '@/lib/redraft/oddTeamExtraMatchup'
import { updateStandings } from '@/lib/redraft/standingsEngine'

const IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
const scores = (pairs: Record<string, number>) => new Map(Object.entries(pairs))

describe('choosing the extra opponent', () => {
  const base = { leagueId: 'L1', week: 5, rosterIds: IDS, standingsOrder: IDS }

  it("default: last week's top scorer", () => {
    const pick = pickExtraMatchupOpponent({
      ...base, leftoverRosterId: 'G', rule: 'top_scorer',
      previousWeekScores: scores({ A: 90, B: 130, C: 100, D: 80, E: 110, F: 70, G: 95 }),
    })
    expect(pick).toEqual({ opponentRosterId: 'B', reason: 'top_scorer' })
  })

  it('the top scorer is the leftover team itself: the next one down', () => {
    const pick = pickExtraMatchupOpponent({
      ...base, leftoverRosterId: 'B', rule: 'top_scorer',
      previousWeekScores: scores({ A: 90, B: 130, C: 100, D: 80, E: 110, F: 70, G: 95 }),
    })
    expect(pick).toEqual({ opponentRosterId: 'E', reason: 'top_scorer' })
  })

  it('median: the middle scorer of the whole league', () => {
    // Sorted: B130 E110 C100 G95 A90 D80 F70 -> the 4th of 7 is G.
    const pick = pickExtraMatchupOpponent({
      ...base, leftoverRosterId: 'A', rule: 'median',
      previousWeekScores: scores({ A: 90, B: 130, C: 100, D: 80, E: 110, F: 70, G: 95 }),
    })
    expect(pick).toEqual({ opponentRosterId: 'G', reason: 'median' })
  })

  it('median lands on the leftover team: the next one down', () => {
    const pick = pickExtraMatchupOpponent({
      ...base, leftoverRosterId: 'G', rule: 'median',
      previousWeekScores: scores({ A: 90, B: 130, C: 100, D: 80, E: 110, F: 70, G: 95 }),
    })
    expect(pick).toEqual({ opponentRosterId: 'A', reason: 'median' })
  })

  it('a tied score goes to the team higher in the standings', () => {
    const tied = scores({ A: 100, B: 100, C: 100, D: 100, E: 100, F: 100, G: 100 })
    expect(pickExtraMatchupOpponent({ ...base, standingsOrder: ['F', 'E', 'D', 'C', 'B', 'A', 'G'], leftoverRosterId: 'G', rule: 'top_scorer', previousWeekScores: tied })?.opponentRosterId).toBe('F')
    // Median of the standings-ordered tie: F E D [C] B A G.
    expect(pickExtraMatchupOpponent({ ...base, standingsOrder: ['F', 'E', 'D', 'C', 'B', 'A', 'G'], leftoverRosterId: 'G', rule: 'median', previousWeekScores: tied })?.opponentRosterId).toBe('C')
  })

  it('week 1: the highest projected team, never the leftover', () => {
    const pick = pickExtraMatchupOpponent({
      ...base, week: 1, leftoverRosterId: 'C', rule: 'top_scorer', previousWeekScores: null,
      projections: scores({ A: 101, B: 99, C: 140, D: 120 }),
    })
    expect(pick).toEqual({ opponentRosterId: 'D', reason: 'projected' })
  })

  it('week 1 without projections: a seeded draw, the same every time, never the leftover', () => {
    const draw = (leagueId: string, week: number, leftover: string) =>
      pickExtraMatchupOpponent({ ...base, leagueId, week, leftoverRosterId: leftover, rule: 'top_scorer', previousWeekScores: null })
    const first = draw('L1', 1, 'A')
    expect(first?.reason).toBe('seeded_draw')
    expect(draw('L1', 1, 'A')).toEqual(first)
    const picks = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const leftover = IDS[i % IDS.length]!
      const pick = draw(`league-${i}`, 1, leftover)!
      expect(pick.opponentRosterId).not.toBe(leftover)
      picks.add(pick.opponentRosterId)
    }
    expect(picks.size).toBeGreaterThan(1)
  })

  it('never the leftover team, whatever the rule and scores', () => {
    for (const rule of ['top_scorer', 'median'] as const) {
      for (const leftover of IDS) {
        for (let seed = 0; seed < 20; seed++) {
          const s = new Map(IDS.map((id, i) => [id, ((i * 37 + seed * 11) % 50) + 60]))
          const pick = pickExtraMatchupOpponent({ ...base, leftoverRosterId: leftover, rule, previousWeekScores: s })
          expect(pick?.opponentRosterId).not.toBe(leftover)
        }
      }
    }
  })
})

describe('the settings value', () => {
  it('defaults to off, top scorer, leftover only', () => {
    expect(readExtraMatchupSettings({})).toEqual({ enabled: false, opponent: 'top_scorer', scoring: 'leftover_only' })
  })
  it('refuses an unknown rule or scoring', () => {
    expect(parseExtraMatchupSettings({ enabled: true, opponent: 'worst' }).ok).toBe(false)
    expect(parseExtraMatchupSettings({ enabled: true, scoring: 'triple' }).ok).toBe(false)
    expect(parseExtraMatchupSettings({ enabled: 'yes' }).ok).toBe(false)
    expect(parseExtraMatchupSettings({ enabled: true })).toEqual({ ok: true, value: { enabled: true, opponent: 'top_scorer', scoring: 'leftover_only' } })
  })
})

// Week 2 of a 5-team league. E is the leftover; its bye row carries a pick of A.
function weekRows(scoring: 'leftover_only' | 'both', eScore = 120) {
  const extra = { opponentRosterId: 'A', rule: 'top_scorer', reason: 'top_scorer', scoring, basisWeek: 1, decidedAt: '2026-10-01T00:00:00.000Z' }
  return [
    { id: 'g1', week: 2, homeRosterId: 'A', awayRosterId: 'B', homeScore: 110, awayScore: 90, status: 'final' },
    { id: 'g2', week: 2, homeRosterId: 'C', awayRosterId: 'D', homeScore: 80, awayScore: 85, status: 'final' },
    { id: 'bye', week: 2, homeRosterId: 'E', awayRosterId: null, homeScore: eScore, awayScore: 0, status: 'final', lineupSnapshots: { extraMatchup: extra } },
  ]
}

function arrangeStandings(rows: unknown[]) {
  h.db.redraftRoster.findMany.mockResolvedValue(['A', 'B', 'C', 'D', 'E'].map((id) => ({ id })))
  h.db.redraftMatchup.findMany.mockResolvedValue(rows)
  h.db.redraftSeason.findUnique.mockResolvedValue({ leagueId: 'L1', medianGame: false, league: { medianGame: false, settings: {} } })
  h.db.league.findFirst.mockResolvedValue({ platform: 'sleeper' })
}

function written() {
  return Object.fromEntries(h.db.redraftRoster.update.mock.calls.map(([a]) => [a.where.id, a.data]))
}

describe('scoring the extra game', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.db.redraftRoster.update.mockResolvedValue({})
    h.db.redraftMatchup.updateMany.mockResolvedValue({ count: 0 })
  })

  it('"main matchup only" (default): the extra game counts for the leftover team alone', async () => {
    arrangeStandings(weekRows('leftover_only'))
    await updateStandings('s1', 2)
    const w = written()
    expect([w.E.wins, w.E.losses]).toEqual([1, 0])
    expect([w.A.wins, w.A.losses]).toEqual([1, 0]) // its own game only
    expect(w.E.pointsFor).toBe(120)
    expect(w.E.pointsAgainst).toBe(110)
    expect(w.A.pointsFor).toBe(110) // never counted twice
  })

  it('"both count": the chosen team gets two results', async () => {
    arrangeStandings(weekRows('both'))
    await updateStandings('s1', 2)
    const w = written()
    expect([w.E.wins, w.E.losses]).toEqual([1, 0])
    expect([w.A.wins, w.A.losses]).toEqual([1, 1]) // beat B, lost the extra game to E
    expect(w.A.pointsFor).toBe(110)
  })

  it('"both count": the chosen team can go 2-0', async () => {
    arrangeStandings(weekRows('both', 100))
    await updateStandings('s1', 2)
    const w = written()
    expect([w.A.wins, w.A.losses]).toEqual([2, 0])
    expect([w.E.wins, w.E.losses]).toEqual([0, 1])
  })

  it('an unfinished week counts nothing', () => {
    const rows = weekRows('both')
    rows[2]!.status = 'active'
    expect(extraMatchupResults(rows)).toEqual([])
  })
})

function arrangeAssign(opts: { enabled?: boolean; teams?: number; week?: number; existing?: boolean; playoffStartWeek?: number } = {}) {
  const teams = opts.teams ?? 5
  const ids = IDS.slice(0, teams)
  h.db.redraftSeason.findUnique.mockResolvedValue({
    id: 's1', leagueId: 'L1', playoffStartWeek: opts.playoffStartWeek ?? 15,
    league: { leagueType: 'redraft', settings: { [EXTRA_MATCHUP_SETTINGS_KEY]: { enabled: opts.enabled ?? true, opponent: 'top_scorer', scoring: 'leftover_only' } } },
  })
  h.db.redraftRoster.findMany.mockResolvedValue(ids.map((id, i) => ({ id, playoffSeed: i + 1 })))
  const week = opts.week ?? 3
  const existing = opts.existing ? { extraMatchup: { opponentRosterId: 'B', rule: 'top_scorer', reason: 'top_scorer', scoring: 'leftover_only', basisWeek: week - 1, decidedAt: 'x' } } : null
  h.db.redraftMatchup.findMany.mockResolvedValue([
    { id: 'p1', week: week - 1, homeRosterId: 'A', awayRosterId: 'B', homeScore: 100, awayScore: 90, status: 'final', lineupSnapshots: null },
    { id: 'p2', week: week - 1, homeRosterId: 'C', awayRosterId: 'E', homeScore: 140, awayScore: 70, status: 'final', lineupSnapshots: null },
    { id: 'p3', week: week - 1, homeRosterId: 'D', awayRosterId: null, homeScore: 95, awayScore: 0, status: 'final', lineupSnapshots: null },
    { id: 'c1', week, homeRosterId: 'A', awayRosterId: 'D', homeScore: 0, awayScore: 0, status: 'scheduled', lineupSnapshots: null },
    { id: 'c2', week, homeRosterId: 'B', awayRosterId: 'E', homeScore: 0, awayScore: 0, status: 'scheduled', lineupSnapshots: null },
    { id: 'bye', week, homeRosterId: 'C', awayRosterId: null, homeScore: 0, awayScore: 0, status: 'scheduled', lineupSnapshots: existing },
  ])
  h.db.redraftMatchup.update.mockResolvedValue({})
}

describe('fixing the pick when the week opens', () => {
  beforeEach(() => vi.clearAllMocks())

  it('records the pick on the leftover team\'s bye row; the top scorer is the leftover, so the next one down', async () => {
    arrangeAssign()
    const out = await assignExtraMatchupForWeek({ seasonId: 's1', week: 3, now: new Date('2026-10-01T00:00:00Z') })
    // Week 2: C 140 (the leftover this week), A 100, D 95, B 90, E 70 -> A.
    expect(out).toMatchObject({ status: 'assigned', matchupId: 'bye', record: { opponentRosterId: 'A', reason: 'top_scorer', basisWeek: 2, scoring: 'leftover_only' } })
    expect(h.db.redraftMatchup.update).toHaveBeenCalledTimes(1)
    expect(h.db.redraftMatchup.update.mock.calls[0]![0]).toMatchObject({ where: { id: 'bye' }, data: { lineupSnapshots: { extraMatchup: { opponentRosterId: 'A' } } } })
  })

  it('is idempotent: a week already fixed is never re-decided', async () => {
    arrangeAssign({ existing: true })
    const out = await assignExtraMatchupForWeek({ seasonId: 's1', week: 3 })
    expect(out).toMatchObject({ status: 'already_assigned', record: { opponentRosterId: 'B' } })
    expect(h.db.redraftMatchup.update).not.toHaveBeenCalled()
  })

  it.each([
    ['off', { enabled: false }, 'disabled'],
    ['an even league', { teams: 6 }, 'even_team_count'],
    ['a playoff week', { week: 15, playoffStartWeek: 15 }, 'not_regular_season'],
  ] as const)('does nothing for %s', async (_label, opts, reason) => {
    arrangeAssign(opts)
    const out = await assignExtraMatchupForWeek({ seasonId: 's1', week: opts.week ?? 3 })
    expect(out).toEqual({ status: 'skipped', reason })
    expect(h.db.redraftMatchup.update).not.toHaveBeenCalled()
  })

  it('the screens read it back: "Extra matchup vs <team> (last week\'s top scorer)"', async () => {
    h.db.redraftSeason.findFirst.mockResolvedValue({ id: 's1' })
    h.db.redraftMatchup.findMany.mockResolvedValue([
      { homeRosterId: 'C', lineupSnapshots: { extraMatchup: { opponentRosterId: 'A', rule: 'top_scorer', reason: 'top_scorer', scoring: 'leftover_only', basisWeek: 2, decidedAt: 'x' } } },
    ])
    h.db.redraftRoster.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ teamName: `Team ${where.id}`, ownerName: 'o' }))
    const mine = await readExtraMatchupView({ leagueId: 'L1', season: 2026, week: 3, redraftRosterId: 'C' })
    expect(mine).toMatchObject({ role: 'leftover', label: "Extra matchup vs Team A (last week's top scorer)", countsForYou: true })
    const theirs = await readExtraMatchupView({ leagueId: 'L1', season: 2026, week: 3, redraftRosterId: 'A' })
    expect(theirs).toMatchObject({ role: 'opponent', teamName: 'Team C', countsForYou: false })
    expect(await readExtraMatchupView({ leagueId: 'L1', season: 2026, week: 3, redraftRosterId: 'B' })).toBeNull()
  })
})

function leagueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'league-1', platform: 'native', leagueType: 'redraft', sport: 'NFL', leagueSize: 7, medianGame: true,
    playoffTeams: 4, playoffStartWeek: 15, settings: {}, teams: [], leagueSettings: null, ...overrides,
  }
}

describe('the commissioner setting is AF Commissioner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.hasPlan = false
    h.db.league.findUnique.mockResolvedValue({ dynastyConfig: null, settings: {} })
    h.db.redraftSeason.findFirst.mockResolvedValue(null)
    h.db.redraftPlayoffRound.findFirst.mockResolvedValue(null)
    h.db.league.update.mockResolvedValue({})
  })
  const on = { [EXTRA_MATCHUP_SETTINGS_KEY]: { enabled: true, opponent: 'median', scoring: 'both' } }
  const savedSettings = () => h.db.league.update.mock.calls.map(([a]) => a.data.settings).find(Boolean)

  it('refuses turning it on without the plan', async () => {
    h.db.league.findFirst.mockResolvedValue(leagueRow())
    const { executeLeagueSettingsPatch } = await import('@/lib/league/execute-league-settings-patch')
    const res = await executeLeagueSettingsPatch('u1', { leagueId: 'league-1', settingsMerge: on })
    expect(res.status).toBe(403)
    expect(savedSettings()).toBeUndefined()
  })

  it('saves it for a subscriber', async () => {
    h.hasPlan = true
    h.db.league.findFirst.mockResolvedValue(leagueRow())
    const { executeLeagueSettingsPatch } = await import('@/lib/league/execute-league-settings-patch')
    const res = await executeLeagueSettingsPatch('u1', { leagueId: 'league-1', settingsMerge: on })
    expect(res.status).toBe(200)
    expect(savedSettings()?.[EXTRA_MATCHUP_SETTINGS_KEY]).toEqual({ enabled: true, opponent: 'median', scoring: 'both' })
  })

  it('turning it off is always allowed', async () => {
    h.db.league.findFirst.mockResolvedValue(leagueRow({ settings: on }))
    const { executeLeagueSettingsPatch } = await import('@/lib/league/execute-league-settings-patch')
    const res = await executeLeagueSettingsPatch('u1', {
      leagueId: 'league-1',
      settingsMerge: { [EXTRA_MATCHUP_SETTINGS_KEY]: { enabled: false } },
    })
    expect(res.status).toBe(200)
  })

  it('refuses it for an even league, even with the plan', async () => {
    h.hasPlan = true
    h.db.league.findFirst.mockResolvedValue(leagueRow({ leagueSize: 8 }))
    const { executeLeagueSettingsPatch } = await import('@/lib/league/execute-league-settings-patch')
    const res = await executeLeagueSettingsPatch('u1', { leagueId: 'league-1', settingsMerge: on })
    expect(res.status).toBe(400)
  })
})
