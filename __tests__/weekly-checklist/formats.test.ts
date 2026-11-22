import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The weekly checklist for the formats beyond plain redraft: keeper, dynasty, guillotine and best ball.
 * The pure builder decides which items a format gets; the service decides the format and reads the
 * guillotine chop rows. Both are tested here against a fake store that filters by the `where` sent.
 */

const m = vi.hoisted(() => ({
  league: null as Record<string, unknown> | null,
  rosters: [] as Array<{ id: string; seasonId: string; teamName: string | null; ownerName: string; isEliminated?: boolean; players: Array<Record<string, unknown>> }>,
  gSeasons: [] as Array<{ id: string; leagueId: string; season: number }>,
  eliminations: [] as Array<{ seasonId: string; scoringPeriod: number; eliminatedTeamName: string }>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => m.league) },
    redraftSeason: { findFirst: vi.fn(async () => ({ id: 'S', season: 2026, status: 'in_season', currentWeek: 7, totalWeeks: 17, playoffStartWeek: 7 })) },
    redraftMatchup: { findMany: vi.fn(async () => []) },
    redraftWaiverClaim: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    redraftRoster: { findMany: vi.fn(async ({ where }: { where: { seasonId: string } }) => m.rosters.filter((r) => r.seasonId === where.seasonId)) },
    redraftTradeProposal: { count: vi.fn(async () => 0) },
    leagueTeam: { findMany: vi.fn(async () => []) },
    guillotineSeason: {
      findFirst: vi.fn(async ({ where }: { where: { leagueId: string; season?: number } }) =>
        m.gSeasons.find((g) => g.leagueId === where.leagueId && (where.season == null || g.season === where.season)) ?? null),
    },
    guillotineElimination: {
      findMany: vi.fn(async ({ where }: { where: { seasonId: string; scoringPeriod: number } }) =>
        m.eliminations.filter((e) => e.seasonId === where.seasonId && e.scoringPeriod === where.scoringPeriod)),
    },
  },
}))

import { buildWeeklyChecklist, type WeeklyChecklistInput } from '@/lib/commissioner/weeklyChecklist'
import { checklistFormat, isPlainRedraft, readWeeklyChecklist, waitingChopTiebreak } from '@/lib/commissioner/weeklyChecklistService'

const NOW = new Date('2026-10-21T15:00:00Z')
const HOUR = 3_600_000
const base = (over: Partial<WeeklyChecklistInput> = {}): WeeklyChecklistInput => ({
  leagueId: 'L1', week: 7, totalWeeks: 17, playoffStartWeek: 7,
  lastWeekMatchups: [{ status: 'final' }], pendingClaims: [], processedClaimsLast7Days: 0,
  lineups: [{ teamName: 'Aces', required: 9, filled: 3, unavailable: [] }],
  tradesAwaitingReview: 0, tradeDeadlineWeek: null, dues: null, ...over,
})
const ids = (input: WeeklyChecklistInput) => buildWeeklyChecklist(input, NOW).map((i) => i.id)
const byId = (input: WeeklyChecklistInput) => Object.fromEntries(buildWeeklyChecklist(input, NOW).map((i) => [i.id, i]))

describe('builder: which items each format gets', () => {
  it('plain redraft is unchanged when no format is passed (playoffs this week, lineup flagged)', () => {
    expect(ids(base())).toEqual(['scores', 'waivers', 'lineups', 'trades', 'playoffs'])
  })

  it('best ball has no lineup item — the optimizer sets every lineup', () => {
    expect(ids(base({ format: 'best_ball', lineupsSetThemselves: true }))).toEqual(['scores', 'waivers', 'trades', 'playoffs'])
  })

  it('guillotine has no playoff items, and confirms last week\'s chop by name', () => {
    const items = byId(base({ format: 'guillotine', lastWeekChopped: ['Bolts'] }))
    expect(items.playoffs).toBeUndefined()
    expect(items.final_week).toBeUndefined()
    expect(items.chop).toMatchObject({ status: 'done', title: { en: 'The week 6 chop is done' }, detail: { en: 'Chopped: Bolts. Their players are on waivers.' } })
  })

  it('a tie waiting on the commissioner is a to-do that links to the decision page', () => {
    const deadline = new Date('2026-10-21T20:00:00Z')
    const items = byId(base({ format: 'guillotine', lastWeekChopped: ['Bolts'], chopTiebreak: { week: 6, deadline } }))
    expect(items.chop).toMatchObject({ status: 'todo', href: '/league/L1/guillotine-tiebreak', title: { en: 'You decide the week 6 chop' } })
    expect(items.chop.detail.en).toContain('Pick by Wed, 21 Oct 2026 20:00 UTC')
  })

  it('no chop recorded and no tie: no chop item rather than a guess (the schedule can skip a week)', () => {
    expect(byId(base({ format: 'guillotine', lastWeekChopped: [] })).chop).toBeUndefined()
  })

  it('the chop item is guillotine-only', () => {
    expect(byId(base({ format: 'keeper', lastWeekChopped: ['Bolts'] })).chop).toBeUndefined()
  })
})

describe('checklistFormat', () => {
  const native = { platform: 'native', leagueType: 'redraft', leagueVariant: null, isDynasty: false, bestBallMode: false, guillotineMode: false }

  it('names each covered format', () => {
    expect(checklistFormat(native)).toBe('redraft')
    expect(checklistFormat({ ...native, leagueType: 'keeper' })).toBe('keeper')
    expect(checklistFormat({ ...native, leagueType: 'dynasty' })).toBe('dynasty')
    expect(checklistFormat({ ...native, isDynasty: true })).toBe('dynasty')
    expect(checklistFormat({ ...native, guillotineMode: true })).toBe('guillotine')
    expect(checklistFormat({ ...native, leagueVariant: 'guillotine' })).toBe('guillotine')
    expect(checklistFormat({ ...native, bestBallMode: true })).toBe('best_ball')
    expect(checklistFormat({ ...native, leagueType: 'best_ball' })).toBe('best_ball')
    // A best ball guillotine is a guillotine (the chop is the job); its lineups still set themselves.
    expect(checklistFormat({ ...native, guillotineMode: true, bestBallMode: true })).toBe('guillotine')
  })

  it('refuses every format whose week does not run on these tables, and every imported league', () => {
    for (const leagueType of ['survivor_guillotine', 'salary_cap', 'devy', 'c2c', 'zombie', 'big_brother', 'some_new_type']) {
      expect(checklistFormat({ ...native, leagueType })).toBeNull()
    }
    for (const leagueVariant of ['survivor', 'zombie', 'big_brother', 'pirate', 'devy', 'some_new_variant']) {
      expect(checklistFormat({ ...native, leagueVariant })).toBeNull()
    }
    expect(checklistFormat({ ...native, platform: 'sleeper' })).toBeNull()
    expect(checklistFormat({ ...native, platform: 'espn', leagueType: 'keeper' })).toBeNull()
  })

  it('isPlainRedraft still means plain redraft only', () => {
    expect(isPlainRedraft(native)).toBe(true)
    expect(isPlainRedraft({ ...native, leagueType: 'keeper' })).toBe(false)
  })
})

describe('waitingChopTiebreak', () => {
  const entry = (requestedAt: Date, decided = false) => ({
    tiedRosterIds: ['a', 'b'], needed: 1, requestedAt: requestedAt.toISOString(), ...(decided ? { decidedRosterIds: ['a'], decidedAt: NOW.toISOString() } : {}),
  })

  it('finds this season\'s undecided tie inside its 12-hour window, with its deadline', () => {
    const settings = { guillotine_commissioner_tiebreaks: { '2026:6': entry(new Date(NOW.getTime() - 2 * HOUR)) } }
    expect(waitingChopTiebreak(settings, 2026, NOW)).toEqual({ week: 6, deadline: new Date(NOW.getTime() + 10 * HOUR) })
  })

  it('ignores decided, expired and other-season ties', () => {
    const settings = {
      guillotine_commissioner_tiebreaks: {
        '2026:5': entry(new Date(NOW.getTime() - 2 * HOUR), true),
        '2026:4': entry(new Date(NOW.getTime() - 13 * HOUR)),
        '2025:6': entry(new Date(NOW.getTime() - 1 * HOUR)),
      },
    }
    expect(waitingChopTiebreak(settings, 2026, NOW)).toBeNull()
    expect(waitingChopTiebreak({}, 2026, NOW)).toBeNull()
    expect(waitingChopTiebreak(null, 2026, NOW)).toBeNull()
  })
})

describe('readWeeklyChecklist for the new formats', () => {
  const full = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLX', 'K', 'DEF'].map((slotType, i) => ({ playerName: `P${i}`, slotType, injuryStatus: null, byeWeek: null }))

  beforeEach(() => {
    m.rosters = [
      { id: 'r1', seasonId: 'S', teamName: 'Aces', ownerName: 'a', players: full },
      // Chopped: its players were released, so it would read as an empty lineup if it were counted.
      { id: 'r2', seasonId: 'S', teamName: 'Bolts', ownerName: 'b', isEliminated: true, players: [] },
    ]
    m.gSeasons = [{ id: 'G', leagueId: 'L', season: 2026 }]
    m.eliminations = [
      { seasonId: 'G', scoringPeriod: 6, eliminatedTeamName: 'Bolts' },
      { seasonId: 'G', scoringPeriod: 5, eliminatedTeamName: 'Older' },
    ]
  })

  it('guillotine: last week\'s chop by name, chopped teams owe no lineup, no playoff items', async () => {
    m.league = { platform: 'native', leagueType: 'redraft', leagueVariant: null, isDynasty: false, bestBallMode: false, guillotineMode: true, sport: 'NFL', settings: {}, tradeDeadlineWeek: null }
    const view = await readWeeklyChecklist('L', NOW)
    expect(view).toMatchObject({ applies: true, format: 'guillotine' })
    const items = Object.fromEntries((view as { items: Array<{ id: string; status: string; detail: { en: string } }> }).items.map((i) => [i.id, i]))
    expect(items.chop).toMatchObject({ status: 'done', detail: { en: 'Chopped: Bolts. Their players are on waivers.' } })
    expect(items.lineups).toMatchObject({ status: 'done' })
    expect(items.playoffs).toBeUndefined()
  })

  it('guillotine with a tie waiting: the chop is a to-do', async () => {
    m.league = {
      platform: 'native', leagueType: 'guillotine', leagueVariant: null, isDynasty: false, bestBallMode: false, guillotineMode: true, sport: 'NFL', tradeDeadlineWeek: null,
      settings: { guillotine_commissioner_tiebreaks: { '2026:7': { tiedRosterIds: ['a', 'b'], needed: 1, requestedAt: new Date(NOW.getTime() - HOUR).toISOString() } } },
    }
    const view = await readWeeklyChecklist('L', NOW)
    const chop = (view as { items: Array<{ id: string; status: string }> }).items.find((i) => i.id === 'chop')
    expect(chop).toMatchObject({ status: 'todo' })
  })

  it('best ball: no lineup item', async () => {
    m.league = { platform: 'native', leagueType: 'redraft', leagueVariant: null, isDynasty: false, bestBallMode: true, guillotineMode: false, sport: 'NFL', settings: {}, tradeDeadlineWeek: null }
    const view = await readWeeklyChecklist('L', NOW)
    expect(view).toMatchObject({ applies: true, format: 'best_ball' })
    expect((view as { items: Array<{ id: string }> }).items.map((i) => i.id)).not.toContain('lineups')
  })

  it('keeper and dynasty run the full redraft week', async () => {
    for (const leagueType of ['keeper', 'dynasty']) {
      m.league = { platform: 'native', leagueType, leagueVariant: null, isDynasty: leagueType === 'dynasty', bestBallMode: false, guillotineMode: false, sport: 'NFL', settings: {}, tradeDeadlineWeek: null }
      const view = await readWeeklyChecklist('L', NOW)
      expect(view).toMatchObject({ applies: true, format: leagueType })
      expect((view as { items: Array<{ id: string }> }).items.map((i) => i.id)).toEqual(['waivers', 'lineups', 'trades', 'playoffs'])
    }
  })

  it('an uncovered format still gets no checklist', async () => {
    m.league = { platform: 'native', leagueType: 'redraft', leagueVariant: 'survivor', isDynasty: false, bestBallMode: false, guillotineMode: false, sport: 'NFL', settings: {}, tradeDeadlineWeek: null }
    expect(await readWeeklyChecklist('L', NOW)).toEqual({ applies: false, reason: 'not_redraft' })
  })
})
