// @vitest-environment node
/**
 * ESPN leagues with NO OPPONENT — total-points and knockout formats.
 *
 * 🛑 WHAT WAS BROKEN. `detectEspnMatchupFrequency` already recognised these leagues and
 * the adapter already said so in its coverage note ("ESPN reports this as total points
 * scoring, so there is no paired head-to-head schedule to import"). But the PARSER threw
 * the entries away — `if (!teamId1 || !teamId2) return` discarded the side that was there
 * along with its points — so the collector saw an empty schedule and wrote nothing, and
 * every WeeklyMatchup-backed surface rendered the league blank.
 *
 * Measured on production 2026-09-20: "Washington Pro Knockout PPR League", in season with
 * 18 teams, recorded `weeksWritten: 0, weeksUnchanged: 0` while its five ESPN siblings
 * recorded 13–17 weeks unchanged.
 */
import { describe, it, expect, vi } from 'vitest'

const weeklyFindMany = vi.fn()
const weeklyDeleteMany = vi.fn()
const weeklyCreateMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    weeklyMatchup: {
      findMany: (...a: unknown[]) => weeklyFindMany(...a),
      deleteMany: (...a: unknown[]) => weeklyDeleteMany(...a),
      createMany: (...a: unknown[]) => weeklyCreateMany(...a),
    },
    sportsDataCache: { findUnique: vi.fn(), upsert: vi.fn() },
    league: { findMany: vi.fn() },
    leagueTeam: { findMany: vi.fn() },
  },
}))

import { applySchedule } from '@/lib/import-os/collector/externalMatchupParity'
import { parseEspnScheduleForTest } from '@/lib/league-import/espn/EspnLeagueFetchService'

const idOf = (t: string) => t
const rowsWritten = () => (weeklyCreateMany.mock.calls.at(-1)?.[0] as { data: unknown[] }).data

function reset() {
  weeklyFindMany.mockReset().mockResolvedValue([])
  weeklyDeleteMany.mockReset().mockResolvedValue({ count: 0 })
  weeklyCreateMany.mockReset().mockResolvedValue({ count: 0 })
}

describe('applySchedule — a week with no opponent', () => {
  it('writes ONE row per solo entry, with no invented opponent score or win', async () => {
    reset()
    const out = await applySchedule(idOf, 'L1', [
      { week: 2, season: 2026, matchups: [{ teamId1: '7', teamId2: null, points1: 132.1 }] },
    ])
    expect(out.soloRowsWritten).toBe(1)
    expect(out.weeksWritten).toBe(1)
    expect(rowsWritten()).toEqual([
      { leagueId: 'L1', seasonYear: 2026, week: 2, rosterId: '7', matchupId: 1, pointsFor: 132.1, pointsAgainst: 0, win: 0 },
    ])
  })

  it('treats an empty-string opponent the same as null', async () => {
    reset()
    const out = await applySchedule(idOf, 'L1', [
      { week: 2, season: 2026, matchups: [{ teamId1: '7', teamId2: '', points1: 99 }] },
    ])
    expect(out.soloRowsWritten).toBe(1)
    expect(rowsWritten()).toHaveLength(1)
  })

  /*
   * 🛑 THE REGRESSION GUARD. `applySchedule` is shared by ESPN/Yahoo, Fantrax, Fleaflicker
   * and MFL — every one of them pairs. A change here that altered paired semantics would
   * silently rewrite four providers' history.
   */
  it('leaves a normal pair exactly as it was: two rows, mirrored scores, a win', async () => {
    reset()
    const out = await applySchedule(idOf, 'L1', [
      { week: 1, season: 2026, matchups: [{ teamId1: 'a', teamId2: 'b', points1: 120, points2: 100 }] },
    ])
    expect(out.soloRowsWritten).toBe(0)
    expect(rowsWritten()).toEqual([
      { leagueId: 'L1', seasonYear: 2026, week: 1, rosterId: 'a', matchupId: 1, pointsFor: 120, pointsAgainst: 100, win: 1 },
      { leagueId: 'L1', seasonYear: 2026, week: 1, rosterId: 'b', matchupId: 1, pointsFor: 100, pointsAgainst: 120, win: 0 },
    ])
  })

  /*
   * ⚠ A SOLO ROW MUST NEVER PAIR. `pairRows` groups on (league, season, week, matchupId)
   * and takes groups of exactly two, so distinct matchupIds are what keep a solo unpaired
   * by construction rather than by a flag someone can forget to read.
   */
  it('gives every entry its own matchupId, so a solo cannot pair with anything', async () => {
    reset()
    await applySchedule(idOf, 'L1', [
      {
        week: 3,
        season: 2026,
        matchups: [
          { teamId1: 'a', teamId2: 'b', points1: 1, points2: 2 },
          { teamId1: 'c', teamId2: null, points1: 3 },
          { teamId1: 'd', teamId2: null, points1: 4 },
        ],
      },
    ])
    const rows = rowsWritten() as Array<{ rosterId: string; matchupId: number }>
    expect(rows).toHaveLength(4)
    const solos = rows.filter((r) => r.rosterId === 'c' || r.rosterId === 'd')
    expect(new Set(solos.map((r) => r.matchupId)).size).toBe(2)
    expect(solos.map((r) => r.matchupId)).not.toContain(1)
  })

  it('writes an unplayed solo week as 0-0, which isScored still reads as unplayed', async () => {
    reset()
    await applySchedule(idOf, 'L1', [
      { week: 9, season: 2026, matchups: [{ teamId1: 'a', teamId2: null }] },
    ])
    const row = (rowsWritten() as Array<{ pointsFor: number; pointsAgainst: number }>)[0]
    expect(row.pointsFor).toBe(0)
    expect(row.pointsAgainst).toBe(0)
    expect(row.pointsFor > 0 || row.pointsAgainst > 0).toBe(false)
  })

  it('skips an entry whose roster does not resolve, without dropping the rest of the week', async () => {
    reset()
    const out = await applySchedule((t) => (t === 'ghost' ? null : t), 'L1', [
      {
        week: 4,
        season: 2026,
        matchups: [
          { teamId1: 'ghost', teamId2: null, points1: 50 },
          { teamId1: 'real', teamId2: null, points1: 60 },
        ],
      },
    ])
    expect(out.soloRowsWritten).toBe(1)
    expect(rowsWritten()).toHaveLength(1)
  })
})

describe('parseEspnSchedule — ESPN serves a side with no opponent', () => {
  /*
   * 🛑 THE CORE FIX. This entry was discarded whole, points included.
   */
  it('keeps a home side with no away side, carrying its points', () => {
    const out = parseEspnScheduleForTest(
      { schedule: [{ matchupPeriodId: 2, home: { teamId: 7, totalPoints: 132.1 } }] },
      2026,
      2,
    )
    expect(out).toHaveLength(1)
    expect(out[0].matchups).toEqual([
      { teamId1: '7', teamId2: null, points1: 132.1, points2: undefined },
    ])
  })

  it('normalises an away-only side onto teamId1, so downstream reads one shape', () => {
    const out = parseEspnScheduleForTest(
      { schedule: [{ matchupPeriodId: 2, away: { teamId: 9, totalPoints: 88.5 } }] },
      2026,
      2,
    )
    expect(out[0].matchups).toEqual([
      { teamId1: '9', teamId2: null, points1: 88.5, points2: undefined },
    ])
  })

  it('still parses a normal pair unchanged', () => {
    const out = parseEspnScheduleForTest(
      {
        schedule: [
          { matchupPeriodId: 1, home: { teamId: 1, totalPoints: 120 }, away: { teamId: 2, totalPoints: 100 } },
        ],
      },
      2026,
      1,
    )
    expect(out[0].matchups).toEqual([{ teamId1: '1', teamId2: '2', points1: 120, points2: 100 }])
  })

  it('drops an entry with neither side, rather than inventing one', () => {
    const out = parseEspnScheduleForTest({ schedule: [{ matchupPeriodId: 1, home: {}, away: {} }] }, 2026, 1)
    expect(out).toEqual([])
  })

  /*
   * ⚠ The scoreboard view repeats the current week, so the same solo team arrives twice.
   * Without a solo-aware dedupe key it would be written twice in one week.
   */
  it('dedupes a solo team seen twice in a week, keeping the later points', () => {
    const out = parseEspnScheduleForTest(
      {
        schedule: [{ matchupPeriodId: 3, home: { teamId: 7, totalPoints: 100 } }],
        scoreboard: { matchups: [{ home: { teamId: 7, totalPoints: 132.1 } }] },
      },
      2026,
      3,
    )
    expect(out).toHaveLength(1)
    expect(out[0].matchups).toEqual([
      { teamId1: '7', teamId2: null, points1: 132.1, points2: undefined },
    ])
  })

  it('does not let a solo entry dedupe against a real pair for the same team', () => {
    const out = parseEspnScheduleForTest(
      {
        schedule: [
          { matchupPeriodId: 1, home: { teamId: 1, totalPoints: 120 }, away: { teamId: 2, totalPoints: 100 } },
          { matchupPeriodId: 1, home: { teamId: 1, totalPoints: 55 } },
        ],
      },
      2026,
      1,
    )
    expect(out[0].matchups).toHaveLength(2)
  })
})
