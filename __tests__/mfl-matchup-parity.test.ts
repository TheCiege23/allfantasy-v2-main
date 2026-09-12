// @vitest-environment node
/**
 * Guards `lib/import-os/collector/mflMatchupParity.ts` — the writer MFL waited
 * nine days for, and the one provider whose absence was a real blocker rather
 * than an oversight.
 *
 * 🛑 THE CENTRAL ASSERTION IS THE ZERO-PADDING. MFL franchise ids are padded
 * ("0001"). `WeeklyMatchup.rosterId` used to be an `Int`, so a writer would have
 * stored `1`, and `String(1)` never matches `LeagueTeam.externalId` ("0001")
 * again — rows that look right and that no reader can resolve. The column is
 * TEXT in production now, so the padded id must survive the write VERBATIM.
 * Every other provider's collector canonicalises ids through `String(Number(x))`
 * and is correct to; doing that here silently reintroduces the original bug, and
 * the test named "preserves the zero-padding" is what stops it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const leagueFindMany = vi.fn()
const leagueTeamFindMany = vi.fn()
const cacheFindUnique = vi.fn()
const cacheUpsert = vi.fn()
const weeklyFindMany = vi.fn()
const weeklyDeleteMany = vi.fn()
const weeklyCreateMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: (...a: unknown[]) => leagueFindMany(...a) },
    leagueTeam: { findMany: (...a: unknown[]) => leagueTeamFindMany(...a) },
    sportsDataCache: {
      findUnique: (...a: unknown[]) => cacheFindUnique(...a),
      upsert: (...a: unknown[]) => cacheUpsert(...a),
    },
    weeklyMatchup: {
      findMany: (...a: unknown[]) => weeklyFindMany(...a),
      deleteMany: (...a: unknown[]) => weeklyDeleteMany(...a),
      createMany: (...a: unknown[]) => weeklyCreateMany(...a),
    },
  },
}))

const fetchMflScheduleForSync = vi.fn()
vi.mock('@/lib/league-import/mfl/MflLeagueFetchService', () => ({
  fetchMflScheduleForSync: (...a: unknown[]) => fetchMflScheduleForSync(...a),
}))

import { runMflMatchupParity } from '@/lib/import-os/collector/mflMatchupParity'

const NOW = new Date('2026-10-01T12:00:00Z')
const LEAGUE = '12345'
const SEASON = 2026

/** MFL's real id shape — padded, four digits. */
const F1 = '0001'
const F2 = '0002'
const F3 = '0010'

function week(n: number, matchups: Array<[string, string, number | undefined, number | undefined]>) {
  return {
    week: n,
    season: SEASON,
    matchups: matchups.map(([a, b, p1, p2]) => ({
      franchiseId1: a,
      franchiseId2: b,
      points1: p1,
      points2: p2,
    })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  leagueFindMany.mockResolvedValue([
    { platformLeagueId: LEAGUE, season: SEASON, userId: 'user-1' },
  ])
  leagueTeamFindMany.mockResolvedValue([
    { externalId: F1 },
    { externalId: F2 },
    { externalId: F3 },
  ])
  cacheFindUnique.mockResolvedValue(null)
  cacheUpsert.mockResolvedValue({})
  weeklyFindMany.mockResolvedValue([])
  weeklyDeleteMany.mockResolvedValue({ count: 0 })
  weeklyCreateMany.mockResolvedValue({ count: 0 })
  fetchMflScheduleForSync.mockResolvedValue({ schedule: [] })
})

function writtenRows(): Array<Record<string, unknown>> {
  return weeklyCreateMany.mock.calls.flatMap(
    (c) => (c[0] as { data: Array<Record<string, unknown>> }).data,
  )
}

describe('mfl matchup parity — zero-padded franchise identity', () => {
  it('preserves the zero-padding: "0001" is written as "0001", never "1"', async () => {
    fetchMflScheduleForSync.mockResolvedValue({
      schedule: [week(1, [[F1, F2, 120.5, 98.25]])],
    })

    const result = await runMflMatchupParity({ now: NOW })

    expect(result.synced).toBe(1)
    const ids = writtenRows().map((r) => r.rosterId)
    expect(ids).toEqual(expect.arrayContaining(['0001', '0002']))
    // 🛑 The regression this whole writer waited for. If a future edit canonicalises
    // ids, these fire and name the reason.
    expect(ids).not.toContain('1')
    expect(ids).not.toContain('2')
    expect(ids.every((v) => typeof v === 'string')).toBe(true)
  })

  it('a padded id still round-trips when it has interior digits ("0010")', async () => {
    fetchMflScheduleForSync.mockResolvedValue({
      schedule: [week(1, [[F3, F1, 88, 77]])],
    })
    await runMflMatchupParity({ now: NOW })
    const ids = writtenRows().map((r) => r.rosterId)
    expect(ids).toContain('0010')
    expect(ids).not.toContain('10')
  })

  it('writes both sides with the scores the right way round', async () => {
    fetchMflScheduleForSync.mockResolvedValue({
      schedule: [week(3, [[F1, F2, 120.5, 98.25]])],
    })
    await runMflMatchupParity({ now: NOW })
    expect(writtenRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          leagueId: LEAGUE,
          seasonYear: SEASON,
          week: 3,
          rosterId: F1,
          pointsFor: 120.5,
          pointsAgainst: 98.25,
          win: 1,
        }),
        expect.objectContaining({ rosterId: F2, pointsFor: 98.25, pointsAgainst: 120.5, win: 0 }),
      ]),
    )
  })
})

describe('mfl matchup parity — unplayed weeks', () => {
  it('does NOT write a week whose scores are undefined', async () => {
    fetchMflScheduleForSync.mockResolvedValue({
      schedule: [week(5, [[F1, F2, undefined, undefined]])],
    })
    const result = await runMflMatchupParity({ now: NOW })
    expect(writtenRows()).toHaveLength(0)
    expect(result.skipped).toBe(1)
    expect(result.results[0]?.note).toMatch(/no played week/i)
  })

  it('positive control: the identical week WITH scores is written', async () => {
    fetchMflScheduleForSync.mockResolvedValue({
      schedule: [week(5, [[F1, F2, 101, 99]])],
    })
    const result = await runMflMatchupParity({ now: NOW })
    expect(result.synced).toBe(1)
    expect(writtenRows()).toHaveLength(2)
  })

  it('a real 0-0 result IS written — zero is a score, undefined is not', async () => {
    /*
     * The distinction the whole "played weeks only" rule rests on. If this ever
     * fails, the collector has started treating 0 as absent and every genuine
     * forfeit/nil-all week silently disappears.
     */
    fetchMflScheduleForSync.mockResolvedValue({
      schedule: [week(7, [[F1, F2, 0, 0]])],
    })
    const result = await runMflMatchupParity({ now: NOW })
    expect(result.synced).toBe(1)
    expect(writtenRows()).toHaveLength(2)
    expect(writtenRows()[0]).toMatchObject({ pointsFor: 0, pointsAgainst: 0, win: 0 })
  })

  it('keeps the played weeks from a schedule that also contains future ones', async () => {
    fetchMflScheduleForSync.mockResolvedValue({
      schedule: [
        week(1, [[F1, F2, 110, 90]]),
        week(2, [[F1, F2, 100, 105]]),
        week(3, [[F1, F2, undefined, undefined]]),
      ],
    })
    await runMflMatchupParity({ now: NOW })
    expect(new Set(writtenRows().map((r) => r.week))).toEqual(new Set([1, 2]))
  })
})

describe('mfl matchup parity — identity comes from LeagueTeam', () => {
  it('drops a pairing whose franchise has no LeagueTeam row, and drops it WHOLE', async () => {
    fetchMflScheduleForSync.mockResolvedValue({
      schedule: [
        week(1, [
          [F1, F2, 120, 98],
          [F3, '0099', 100, 90], // 0099 was never imported
        ]),
      ],
    })
    await runMflMatchupParity({ now: NOW })
    const ids = writtenRows().map((r) => r.rosterId)
    expect(ids).toEqual(expect.arrayContaining([F1, F2]))
    expect(ids).not.toContain('0099')
    // the mappable half goes too — a row against nobody is worse than no row
    expect(ids).not.toContain(F3)
  })

  it('an unpadded id from MFL does not match a padded LeagueTeam row', async () => {
    /*
     * ⚠ ASSERTS THE STRICTNESS DELIBERATELY. "1" and "0001" are different teams as
     * far as this join is concerned, and that is correct: silently accepting "1"
     * for "0001" is precisely the coercion that made the old Int column unusable.
     * If a real league ever returns unpadded ids, the fix is to record why, not to
     * loosen the comparison here.
     */
    fetchMflScheduleForSync.mockResolvedValue({
      schedule: [week(1, [['1', '2', 120, 98]])],
    })
    const result = await runMflMatchupParity({ now: NOW })
    expect(writtenRows()).toHaveLength(0)
    expect(result.skipped).toBe(1)
  })

  it('skips a league with no LeagueTeam rows, without calling the provider', async () => {
    leagueTeamFindMany.mockResolvedValue([])
    const result = await runMflMatchupParity({ now: NOW })
    expect(result.skipped).toBe(1)
    expect(writtenRows()).toHaveLength(0)
    expect(fetchMflScheduleForSync).not.toHaveBeenCalled()
    expect(result.results[0]?.note).toMatch(/LeagueTeam/i)
  })
})

describe('mfl matchup parity — credentials', () => {
  it('tries the next importing user when the first has no working credential', async () => {
    leagueFindMany.mockResolvedValue([
      { platformLeagueId: LEAGUE, season: SEASON, userId: 'user-1' },
      { platformLeagueId: LEAGUE, season: SEASON, userId: 'user-2' },
    ])
    fetchMflScheduleForSync
      .mockRejectedValueOnce(new Error('no MFL credential for user'))
      .mockResolvedValueOnce({ schedule: [week(1, [[F1, F2, 120, 98]])] })

    const result = await runMflMatchupParity({ now: NOW })

    expect(fetchMflScheduleForSync).toHaveBeenCalledTimes(2)
    expect(result.synced).toBe(1)
    expect(writtenRows()).toHaveLength(2)
  })

  it('skips with an honest note when no candidate works — never fails the league', async () => {
    fetchMflScheduleForSync.mockRejectedValue(new Error('MFL auth expired'))
    const result = await runMflMatchupParity({ now: NOW })
    expect(result.skipped).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.results[0]?.note).toMatch(/MFL auth expired/)
  })

  it('bounds credential probes per league', async () => {
    leagueFindMany.mockResolvedValue(
      ['u1', 'u2', 'u3', 'u4', 'u5'].map((userId) => ({
        platformLeagueId: LEAGUE,
        season: SEASON,
        userId,
      })),
    )
    fetchMflScheduleForSync.mockRejectedValue(new Error('nope'))
    await runMflMatchupParity({ now: NOW })
    expect(fetchMflScheduleForSync).toHaveBeenCalledTimes(3) // MAX_USER_CANDIDATES
  })
})

describe('mfl matchup parity — idempotency', () => {
  it('leaves a week untouched when the stored rows already match', async () => {
    fetchMflScheduleForSync.mockResolvedValue({
      schedule: [week(1, [[F1, F2, 120.5, 98.25]])],
    })
    weeklyFindMany.mockResolvedValue([
      { rosterId: F1, matchupId: 1, pointsFor: 120.5, pointsAgainst: 98.25, win: 1 },
      { rosterId: F2, matchupId: 1, pointsFor: 98.25, pointsAgainst: 120.5, win: 0 },
    ])
    const result = await runMflMatchupParity({ now: NOW })
    expect(weeklyDeleteMany).not.toHaveBeenCalled()
    expect(weeklyCreateMany).not.toHaveBeenCalled()
    expect(result.results[0]).toMatchObject({ status: 'synced', weeksWritten: 0, weeksUnchanged: 1 })
  })

  it('rewrites the week when a score has changed', async () => {
    fetchMflScheduleForSync.mockResolvedValue({
      schedule: [week(1, [[F1, F2, 121.5, 98.25]])],
    })
    weeklyFindMany.mockResolvedValue([
      { rosterId: F1, matchupId: 1, pointsFor: 120.5, pointsAgainst: 98.25, win: 1 },
      { rosterId: F2, matchupId: 1, pointsFor: 98.25, pointsAgainst: 120.5, win: 0 },
    ])
    await runMflMatchupParity({ now: NOW })
    expect(weeklyDeleteMany).toHaveBeenCalledTimes(1)
    expect(writtenRows()).toHaveLength(2)
  })
})
