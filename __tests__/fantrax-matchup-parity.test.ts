// @vitest-environment node
/**
 * Guards `lib/import-os/collector/fantraxMatchupParity.ts` — the writer
 * Fantrax leagues never had.
 *
 * 🛑 WHAT WAS BROKEN. Every WeeklyMatchup-backed surface (current week,
 * scoreboard, power board, standings records) reads `WeeklyMatchup`, and
 * NOTHING wrote it for Fantrax. Sleeper has `ensureMatchupsCached`; ESPN and
 * Yahoo got `externalMatchupParity`; Fantrax got no writer at all, which is why
 * its league home says "we cannot tell which week this league is in yet" and
 * "no week has been scored yet".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const fantraxLeagueFindMany = vi.fn()
const leagueFindMany = vi.fn()
const leagueTeamFindMany = vi.fn()
const cacheFindUnique = vi.fn()
const cacheUpsert = vi.fn()
const weeklyFindMany = vi.fn()
const weeklyDeleteMany = vi.fn()
const weeklyCreateMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    fantraxLeague: { findMany: (...a: unknown[]) => fantraxLeagueFindMany(...a) },
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

const getFantraxLeagueInfo = vi.fn()
const fetchFantraxScheduleWithScores = vi.fn()

vi.mock('@/lib/league-import/fantrax/fantraxApi', () => ({
  getFantraxLeagueInfo: (...a: unknown[]) => getFantraxLeagueInfo(...a),
  fetchFantraxScheduleWithScores: (...a: unknown[]) => fetchFantraxScheduleWithScores(...a),
}))

import { runFantraxMatchupParity } from '@/lib/import-os/collector/fantraxMatchupParity'

const NOW = new Date('2026-10-01T12:00:00Z')

/** `LeagueTeam.externalId` is numeric now — see fantraxTeamIds.ts for why. */
const TEAMS = [
  { externalId: '1483920211', teamName: 'Ciege82', ownerName: null },
  { externalId: '77120044', teamName: 'king gustov', ownerName: null },
]

function fixture(over: Record<string, unknown> = {}) {
  return {
    week: 1,
    awayTeam: 'Ciege82',
    homeTeam: 'king gustov',
    awayTeamId: 'qoat4t4imm8jp61g',
    homeTeamId: 'j0m5j9u6mm8jp61f',
    awayScore: 118.4,
    homeScore: 96.2,
    played: true,
    isPlayoff: false,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  fantraxLeagueFindMany.mockResolvedValue([
    { id: 'league-uuid', sourceLeagueId: 'v2kzedypmm8jp61b', season: 2026, leagueName: 'Cream Bowl' },
  ])
  leagueFindMany.mockResolvedValue([{ platformLeagueId: 'league-uuid', season: 2026 }])
  leagueTeamFindMany.mockResolvedValue(TEAMS)
  cacheFindUnique.mockResolvedValue(null)
  cacheUpsert.mockResolvedValue({})
  weeklyFindMany.mockResolvedValue([])
  weeklyDeleteMany.mockResolvedValue({ count: 0 })
  weeklyCreateMany.mockResolvedValue({ count: 2 })
  getFantraxLeagueInfo.mockResolvedValue({ ok: true, data: { leagueName: 'Cream Bowl' } })
  fetchFantraxScheduleWithScores.mockResolvedValue({
    rows: [fixture()],
    position: { period: 4, state: 'in_progress', scoredThrough: 4 },
    periodsRead: 4,
    periodsFailed: 0,
  })
})

describe('writing a scored Fantrax week', () => {
  it('writes both sides of the pairing under the roster ids LeagueTeam holds', async () => {
    const out = await runFantraxMatchupParity({ now: NOW })

    expect(out.synced).toBe(1)
    expect(weeklyCreateMany).toHaveBeenCalledTimes(1)
    const rows = (weeklyCreateMany.mock.calls[0][0] as { data: Array<Record<string, unknown>> }).data
    expect(rows).toHaveLength(2)
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          leagueId: 'league-uuid',
          rosterId: '1483920211',
          pointsFor: 118.4,
          pointsAgainst: 96.2,
          win: 1,
        }),
        expect.objectContaining({ rosterId: '77120044', pointsFor: 96.2, pointsAgainst: 118.4, win: 0 }),
      ]),
    )
  })

  /**
   * ⚠ THE JOIN KEY IS `League.platformLeagueId`, NOT the Fantrax league id.
   * Writing rows under `v2kzedypmm8jp61b` would store them where no reader
   * looks — the surfaces would stay empty and the sync would report success.
   */
  it('keys rows on platformLeagueId, never on the Fantrax source id', async () => {
    await runFantraxMatchupParity({ now: NOW })
    const rows = (weeklyCreateMany.mock.calls[0][0] as { data: Array<Record<string, unknown>> }).data
    for (const r of rows) expect(r.leagueId).toBe('league-uuid')
  })
})

/**
 * 🛑 THE RULE THIS COLLECTOR EXISTS TO KEEP. `applySchedule` coerces a missing
 * score to 0 because for Sleeper/ESPN/Yahoo an unplayed week legitimately
 * bootstraps as a 0-0 placeholder. For Fantrax that is actively wrong: readers
 * treat `pointsFor === 0 && pointsAgainst === 0` as unplayed, so a FUTURE
 * fixture written as 0-0 is indistinguishable from a real result of zero.
 */
describe('unplayed fixtures are not written at all', () => {
  it('skips a league whose season has not started, and says so', async () => {
    fetchFantraxScheduleWithScores.mockResolvedValue({
      rows: [fixture({ awayScore: null, homeScore: null, played: false })],
      position: { period: 1, state: 'preseason', scoredThrough: 0 },
      periodsRead: 0,
      periodsFailed: 0,
    })

    const out = await runFantraxMatchupParity({ now: NOW })

    expect(out.synced).toBe(0)
    expect(out.skipped).toBe(1)
    expect(out.results[0].note).toMatch(/season has not started/i)
    expect(weeklyCreateMany).not.toHaveBeenCalled()
  })

  it('writes the played week and leaves the unplayed one absent', async () => {
    fetchFantraxScheduleWithScores.mockResolvedValue({
      rows: [
        fixture({ week: 1 }),
        fixture({ week: 2, awayScore: null, homeScore: null, played: false }),
      ],
      position: { period: 2, state: 'in_progress', scoredThrough: 2 },
      periodsRead: 2,
      periodsFailed: 0,
    })

    await runFantraxMatchupParity({ now: NOW })

    const weeks = weeklyCreateMany.mock.calls.map(
      (c) => (c[0] as { data: Array<{ week: number }> }).data[0].week,
    )
    expect(weeks).toEqual([1])
  })

  /** A genuine scoreless week HAS been played, and must be stored. */
  it('stores a real 0-0 result', async () => {
    fetchFantraxScheduleWithScores.mockResolvedValue({
      rows: [fixture({ awayScore: 0, homeScore: 0, played: true })],
      position: { period: 1, state: 'in_progress', scoredThrough: 1 },
      periodsRead: 1,
      periodsFailed: 0,
    })

    await runFantraxMatchupParity({ now: NOW })

    expect(weeklyCreateMany).toHaveBeenCalledTimes(1)
    const rows = (weeklyCreateMany.mock.calls[0][0] as { data: Array<Record<string, unknown>> }).data
    expect(rows).toHaveLength(2)
  })
})

describe('never inventing a roster id', () => {
  /**
   * ⚠ A WRONG ROSTER ID FILES SOMEBODY ELSE'S WEEK UNDER YOUR TEAM, silently.
   * A team the league does not know is dropped rather than numbered by guess.
   */
  it('drops a pairing whose team is not in LeagueTeam', async () => {
    fetchFantraxScheduleWithScores.mockResolvedValue({
      rows: [fixture({ homeTeam: 'A Team Nobody Imported' })],
      position: { period: 1, state: 'in_progress', scoredThrough: 1 },
      periodsRead: 1,
      periodsFailed: 0,
    })

    const out = await runFantraxMatchupParity({ now: NOW })

    expect(weeklyCreateMany).not.toHaveBeenCalled()
    expect(out.skipped).toBe(1)
  })

  /**
   * ⚠ A LEAGUE STILL ON LEGACY `fantrax-team:` IDS IS SKIPPED WITH A NOTE THAT
   * NAMES THE FIX. Writing rows there would produce a scoreboard on which no
   * team can be named, because every reader resolves a name through
   * `Number(LeagueTeam.externalId)`.
   */
  it('refuses a league the team-id backfill has not reached, and names the script', async () => {
    leagueTeamFindMany.mockResolvedValue([
      { externalId: 'fantrax-team:ciege82', teamName: 'Ciege82', ownerName: null },
    ])

    const out = await runFantraxMatchupParity({ now: NOW })

    expect(out.skipped).toBe(1)
    expect(out.results[0].note).toMatch(/backfill-fantrax-team-ids/)
    expect(weeklyCreateMany).not.toHaveBeenCalled()
  })
})

describe('enumeration and cadence', () => {
  /**
   * ⚠ A CSV-ERA SNAPSHOT HAS NO FANTRAX LEAGUE ID AND NEVER WILL. It is skipped
   * at enumeration rather than reported as a failure — permanently
   * un-refreshable is a real state, not an error.
   */
  it('never enumerates a snapshot with no source league id', async () => {
    fantraxLeagueFindMany.mockResolvedValue([])
    const out = await runFantraxMatchupParity({ now: NOW })
    expect(out.enumerated).toBe(0)
    expect(getFantraxLeagueInfo).not.toHaveBeenCalled()
  })

  it('skips a snapshot that never became a League row', async () => {
    leagueFindMany.mockResolvedValue([])
    const out = await runFantraxMatchupParity({ now: NOW })
    expect(out.enumerated).toBe(0)
  })

  it('does not re-read a league inside its cadence window', async () => {
    cacheFindUnique.mockResolvedValue({ expiresAt: new Date(NOW.getTime() + 60_000) })
    const out = await runFantraxMatchupParity({ now: NOW })
    expect(out.notDue).toBe(1)
    expect(getFantraxLeagueInfo).not.toHaveBeenCalled()
  })

  /** ⚠ FAILS OPEN: an unreadable cadence row must not silence a league forever. */
  it('syncs when the cadence row cannot be read', async () => {
    cacheFindUnique.mockRejectedValue(new Error('cache down'))
    const out = await runFantraxMatchupParity({ now: NOW })
    expect(out.synced).toBe(1)
  })

  it('reports a provider failure as skipped rather than throwing', async () => {
    getFantraxLeagueInfo.mockResolvedValue({
      ok: false,
      failure: { kind: 'not_found', message: 'league ID: x not found' },
    })
    const out = await runFantraxMatchupParity({ now: NOW })
    expect(out.skipped).toBe(1)
    expect(out.results[0].note).toMatch(/not found/i)
  })
})
