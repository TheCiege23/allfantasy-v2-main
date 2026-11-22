/**
 * The lineup screen's day picker and the score breakdown read `loadDailyLineupView`. Its week total
 * must be the matchup's own number, so this drives both against the same rows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type AnyArgs = Record<string, any>

const db = vi.hoisted(() => ({
  league: { findFirst: vi.fn(), findUnique: vi.fn() },
  redraftDailyLineup: { findMany: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  roster: { findMany: vi.fn(async () => []) },
  afRosterLineupAssignment: { findMany: vi.fn(async () => []) },
  playerDailyScore: { findMany: vi.fn() },
  playerWeeklyScore: { findUnique: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({ leagueUsesDevyEngine: vi.fn(async () => false), calculateOfficialTeamScore: vi.fn() }))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import { loadDailyLineupView } from '@/lib/redraft/dailyLineupView'
import { scoreRosterForWeek } from '@/lib/redraft/scoringEngine'

const DAILY_ON = { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } }
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const rows = [
  { id: 'a', rosterId: 'r1', playerId: 'tatum', playerName: 'Tatum', position: 'SF', sport: 'NBA', slotType: 'bench', addedAt: new Date('2026-10-01T12:00:00Z'), droppedAt: null },
  { id: 'b', rosterId: 'r1', playerId: 'butler', playerName: 'Butler', position: 'SF', sport: 'NBA', slotType: 'SF', addedAt: new Date('2026-10-01T12:00:00Z'), droppedAt: null },
]

beforeEach(() => {
  vi.clearAllMocks()
  db.league.findFirst.mockResolvedValue({ sport: 'NBA', settings: DAILY_ON })
  db.league.findUnique.mockResolvedValue({ sport: 'NBA', settings: DAILY_ON })
  db.redraftRosterPlayer.findMany.mockImplementation(async ({ where }: AnyArgs) => (where.playerId ? [] : rows))
  // Tatum starts Tuesday; a Wednesday save benches him and starts Butler.
  db.redraftDailyLineup.findMany.mockResolvedValue([
    { rosterId: 'r1', playerId: 'tatum', scoringDay: day('2026-10-20'), slotType: 'SF' },
    { rosterId: 'r1', playerId: 'butler', scoringDay: day('2026-10-20'), slotType: 'bench' },
    { rosterId: 'r1', playerId: 'tatum', scoringDay: day('2026-10-21'), slotType: 'bench' },
    { rosterId: 'r1', playerId: 'butler', scoringDay: day('2026-10-21'), slotType: 'SF' },
  ])
  db.playerDailyScore.findMany.mockResolvedValue([
    { playerId: 'tatum', scoringDay: day('2026-10-20'), stats: { pts: 31, reb: 7 }, isFinalized: false },
    { playerId: 'tatum', scoringDay: day('2026-10-22'), stats: { pts: 12 }, isFinalized: false },
    { playerId: 'butler', scoringDay: day('2026-10-20'), stats: { pts: 18 }, isFinalized: false },
    { playerId: 'butler', scoringDay: day('2026-10-23'), stats: { pts: 22, ast: 5 }, isFinalized: false },
  ])
  db.playerWeeklyScore.findUnique.mockResolvedValue({ isFinalized: false })
})

describe('loadDailyLineupView', () => {
  it("totals the week exactly as the matchup scorer does", async () => {
    const now = new Date('2026-10-23T16:00:00Z') // Friday noon ET
    const view = await loadDailyLineupView(db as never, { leagueId: 'L1', redraftRosterId: 'r1', season: 2026, week: 1, now })
    const matchup = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 1, seasonYear: 2026 })
    expect(view).not.toBeNull()
    expect(view!.weekPoints).toBeGreaterThan(0)
    expect(view!.weekPoints).toBe(matchup.points)
  })

  it('marks each day past, today or future, and keeps each day its own slots and points', async () => {
    const view = (await loadDailyLineupView(db as never, {
      leagueId: 'L1', redraftRosterId: 'r1', season: 2026, week: 1, now: new Date('2026-10-23T16:00:00Z'),
    }))!
    expect(view.today).toBe('2026-10-23')
    expect(view.days.map((d) => d.status)).toEqual(['past', 'past', 'past', 'today', 'future', 'future', 'future'])
    const tue = view.days[0]
    expect(tue.slots).toEqual({ tatum: 'SF', butler: 'bench' })
    expect(Object.keys(tue.points).sort()).toEqual(['butler', 'tatum'])
    // Thursday carries Wednesday's lineup: Tatum's 12 came off the bench, so it is not a starter point.
    const thu = view.days[2]
    expect(thu.slots.tatum).toBe('bench')
    expect(thu.starterPoints).toBe(0)
    expect(Object.keys(view.startedPoints).sort()).toEqual(['butler', 'tatum'])
  })

  it('is null for a league that is not on daily lineups', async () => {
    db.league.findFirst.mockResolvedValue({ sport: 'NBA', settings: {} })
    const view = await loadDailyLineupView(db as never, { leagueId: 'L1', redraftRosterId: 'r1', season: 2026, week: 1 })
    expect(view).toBeNull()
    expect(db.redraftDailyLineup.findMany).not.toHaveBeenCalled()
  })
})
