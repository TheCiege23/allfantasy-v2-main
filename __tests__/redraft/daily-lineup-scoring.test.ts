import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn(), findFirst: vi.fn() },
  devyLeague: { findUnique: vi.fn(async () => null) },
  roster: { findMany: vi.fn(async () => []) },
  afRosterLineupAssignment: { findMany: vi.fn(async () => []) },
  redraftRosterPlayer: { findMany: vi.fn() },
  redraftDailyLineup: { findMany: vi.fn() },
  playerDailyScore: { findMany: vi.fn() },
  playerWeeklyScore: { findUnique: vi.fn() },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { expandDailySlots, onRosterOnDay } from '@/lib/redraft/dailyScoring'
import { scoreRosterForWeek } from '@/lib/redraft/scoringEngine'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const DAILY_NBA = { sport: 'NBA', settings: { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } } }

const player = (playerId: string, slotType: string, extra: Record<string, unknown> = {}) => ({
  id: `row-${playerId}`, rosterId: 'rd1', playerId, position: 'SF', sport: 'NBA', slotType,
  addedAt: new Date('2026-10-01T12:00:00Z'), droppedAt: null, ...extra,
})

/** A saved lineup for every day from `fromIso` to the week's end (Mon 10-26). */
function savedFrom(fromIso: string, slots: Record<string, string>) {
  const out: Array<{ rosterId: string; scoringDay: Date; playerId: string; slotType: string }> = []
  for (let t = day(fromIso).getTime(); t < day('2026-10-27').getTime(); t += 86_400_000) {
    for (const [playerId, slotType] of Object.entries(slots)) out.push({ rosterId: 'rd1', scoringDay: new Date(t), playerId, slotType })
  }
  return out
}

const pts = (playerId: string, iso: string, points: number) => ({ playerId, sport: 'NBA', scoringDay: day(iso), stats: { pts: points } })

beforeEach(() => {
  vi.clearAllMocks()
  db.league.findUnique.mockResolvedValue(DAILY_NBA)
  db.league.findFirst.mockResolvedValue({ ...DAILY_NBA, bestBallMode: false, leagueVariant: null, leagueType: 'redraft' })
  db.playerWeeklyScore.findUnique.mockResolvedValue({ isFinalized: true })
})

describe('scoreRosterForWeek in a daily-lineup league', () => {
  it("scores each day's starters on that day's points only", async () => {
    db.redraftRosterPlayer.findMany.mockResolvedValue([
      player('tatum', 'bench'),
      player('butler', 'SF'),
      // Dropped on Thursday: his Tuesday game counts, his Friday game for a new team does not.
      player('kd', 'SF', { droppedAt: new Date('2026-10-22T18:00:00Z') }),
      // Added on Friday after the last save: on the bench until a save says otherwise.
      player('rui', 'bench', { addedAt: new Date('2026-10-23T15:00:00Z') }),
    ])
    db.redraftDailyLineup.findMany.mockResolvedValue([
      ...savedFrom('2026-10-20', { tatum: 'SF', butler: 'bench', kd: 'SF' }).filter((r) => r.scoringDay < day('2026-10-21')),
      ...savedFrom('2026-10-21', { tatum: 'bench', butler: 'SF', kd: 'SF' }),
    ])
    db.playerDailyScore.findMany.mockResolvedValue([
      pts('tatum', '2026-10-20', 30), // started → counts
      pts('tatum', '2026-10-21', 10), // benched → no
      pts('butler', '2026-10-20', 20), // benched → no
      pts('butler', '2026-10-22', 25), // started → counts
      pts('kd', '2026-10-20', 12), // started → counts
      pts('kd', '2026-10-23', 9), // dropped the day before → no
      pts('rui', '2026-10-24', 50), // bench → no
    ])

    const summary = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'rd1', week: 1, seasonYear: 2026, includeBench: true })

    expect(summary.points).toBe(30 + 25 + 12)
    expect(summary.benchPoints).toBe(10 + 20 + 50)
    expect(summary.starterCount).toBe(3)
    expect(summary.allFinal).toBe(true)
    expect(summary.missingPlayerIds).toEqual([])
  })

  it("is not final while a day's starter has no weekly row", async () => {
    db.redraftRosterPlayer.findMany.mockResolvedValue([player('tatum', 'SF')])
    db.redraftDailyLineup.findMany.mockResolvedValue(savedFrom('2026-10-20', { tatum: 'SF' }))
    db.playerDailyScore.findMany.mockResolvedValue([])
    db.playerWeeklyScore.findUnique.mockResolvedValue(null)
    const summary = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'rd1', week: 1, seasonYear: 2026 })
    expect(summary.allFinal).toBe(false)
    expect(summary.missingPlayerIds).toEqual(['tatum'])
  })

  it('a week nobody saved scores from the weekly lineup, day by day', async () => {
    db.redraftRosterPlayer.findMany.mockResolvedValue([player('tatum', 'SF'), player('butler', 'bench')])
    db.redraftDailyLineup.findMany.mockResolvedValue([])
    db.playerDailyScore.findMany.mockResolvedValue([pts('tatum', '2026-10-20', 30), pts('butler', '2026-10-21', 40)])
    const summary = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'rd1', week: 1, seasonYear: 2026 })
    expect(summary.points).toBe(30)
  })

  it('a weekly league never reads the daily tables', async () => {
    db.league.findUnique.mockResolvedValue({ sport: 'NBA', settings: {} })
    db.league.findFirst.mockResolvedValue({ sport: 'NBA', settings: {}, bestBallMode: false, leagueVariant: null, leagueType: 'redraft' })
    db.redraftRosterPlayer.findMany.mockResolvedValue([player('tatum', 'SF')])
    db.playerWeeklyScore.findUnique.mockResolvedValue({ stats: { pts: 40 }, isFinalized: true })
    const summary = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'rd1', week: 1, seasonYear: 2026 })
    expect(summary.points).toBe(40)
    expect(db.redraftDailyLineup.findMany).not.toHaveBeenCalled()
    expect(db.playerDailyScore.findMany).not.toHaveBeenCalled()
  })
})

describe('expandDailySlots', () => {
  const days = [day('2026-10-20'), day('2026-10-21'), day('2026-10-22')]
  it('carries the latest saved day forward and falls back before the first save', () => {
    const slots = expandDailySlots({
      days,
      players: [player('tatum', 'bench')],
      savedByDay: new Map([['2026-10-21', new Map([['tatum', 'SF']])]]),
      fallbackSlot: (p) => p.slotType,
    })
    expect(slots.map((s) => s.slotType)).toEqual(['bench', 'SF', 'SF'])
  })
})

describe('onRosterOnDay', () => {
  it('counts the drop day and the add day, not the days outside them', () => {
    const p = { addedAt: new Date('2026-10-21T15:00:00Z'), droppedAt: new Date('2026-10-23T02:00:00Z') } // dropped 10-22 22:00 ET
    expect(onRosterOnDay(p, day('2026-10-20'))).toBe(false)
    expect(onRosterOnDay(p, day('2026-10-21'))).toBe(true)
    expect(onRosterOnDay(p, day('2026-10-22'))).toBe(true)
    expect(onRosterOnDay(p, day('2026-10-23'))).toBe(false)
  })
})
