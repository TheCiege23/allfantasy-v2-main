/**
 * A failed roster read must degrade honestly — it must not crash, and it must not
 * claim your players aren't playing.
 *
 * WHAT HAPPENED (2026-08-27, production)
 * `league_player_weekly_scores` had never been applied to prod, so
 * `loadRosteredPlayers` threw P2021 for every signed-in user with a claimed team.
 * The throw escaped `getLivePageData`, `/live` rendered blank, and `/core/live`
 * hit its `.catch(() => null)` and rendered "We could not read the slate just
 * now" — blaming the slate, which had loaded perfectly. Two deploys chased it as
 * a scores bug because of that copy.
 *
 * WHAT IS PINNED HERE
 *   1. The throw is contained — `getLivePageData` resolves rather than rejecting.
 *   2. `rosterFailed` is TRUE, so the UI can say what actually broke.
 *   3. `loadFailed` stays FALSE. This is the whole point of a second flag: the
 *      slate is fine, and saying otherwise is the misdirection that cost two
 *      deploys.
 *   4. The slate SURVIVES under `scope: 'all'`. A roster fault must not discard
 *      games that were already fetched.
 *   5. The control: a roster read that succeeds leaves `rosterFailed` false, so
 *      the flag tracks the failure rather than being pinned on.
 *
 * ⚠ 2 AND 3 TOGETHER ARE THE TEST. Catching alone would swap a crash for a lie:
 * `scope: 'my'` is the DEFAULT, and with no tie-ins it filters every game away,
 * so a silent degrade renders "None of your players are playing right now" to
 * someone whose players may be on the field. Asserting only "it did not throw"
 * would pass on exactly that bug.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { leagueTeamFindMany, weeklyScoreFindMany, sportsPlayerFindMany, getLiveScores, getCachedLiveScores, getPlayFeedMock } =
  vi.hoisted(() => ({
    leagueTeamFindMany: vi.fn(),
    weeklyScoreFindMany: vi.fn(),
    sportsPlayerFindMany: vi.fn(async () => [] as unknown[]),
    getLiveScores: vi.fn(),
    getCachedLiveScores: vi.fn(async () => ({ scores: [], fetchedAt: null })),
    getPlayFeedMock: vi.fn(async () => [] as unknown[]),
  }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: leagueTeamFindMany },
    leaguePlayerWeeklyScore: { findMany: weeklyScoreFindMany },
    sportsPlayer: { findMany: sportsPlayerFindMany },
  },
}))

/*
 * ⚠ PARTIAL, VIA importOriginal — A FULL MOCK ROTS THE MOMENT THE MODULE GROWS.
 * This listed only the two fetchers, so when `liveScoresPage` started importing
 * `hasStarted` from the same module the mock stopped supplying it and every test
 * in this file died on "No 'hasStarted' export is defined on the mock" — a
 * failure in the TEST HARNESS that reads exactly like a product crash in
 * getLivePageData, which is where the stack pointed.
 *
 * Only the two network calls need stubbing. `hasStarted` is a pure status
 * predicate with no I/O, and the assertions here depend on its real behaviour —
 * stubbing it would let a broken predicate pass this suite. Spreading the actual
 * module keeps every future pure helper working without another edit here.
 */
vi.mock('@/lib/sports-live-scores-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sports-live-scores-service')>()),
  getLiveScoresForSport: getLiveScores,
  getCachedLiveScoresForSport: getCachedLiveScores,
}))

vi.mock('@/lib/live/playFeedPresentation', () => ({ getPlayFeed: getPlayFeedMock }))

import { getLivePageData } from '@/lib/live/liveScoresPage'

/** One in-window game, shaped like the ESPN mapper's output. */
function row() {
  return {
    gameId: 'g1',
    homeTeam: 'BUF',
    homeTeamFull: 'Buffalo Bills',
    homeLogo: '',
    homeScore: 10,
    homeRecord: '1-0',
    awayTeam: 'PIT',
    awayTeamFull: 'Pittsburgh Steelers',
    awayLogo: '',
    awayScore: 7,
    awayRecord: '0-1',
    status: 'STATUS_IN_PROGRESS',
    statusDetail: 'Q2 5:00',
    period: 2,
    clock: '5:00',
    completed: false,
    // Inside the slate window (now -6h .. +18h), which loadActiveSlate enforces.
    startTime: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    venue: null,
    broadcast: null,
    odds: null,
    overUnder: null,
    week: 1,
    season: 2026,
    topPerformer: null,
  }
}

/** A claimed NFL team, so loadRosteredPlayers gets past its early returns and
 *  actually reaches the weekly-scores read that throws. */
const claimedNflTeam = [
  {
    leagueId: 'L1',
    league: { id: 'L1', name: 'Turf Wars', platformLeagueId: 'p1', sport: 'NFL', season: 2026 },
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  getLiveScores.mockResolvedValue({ scores: [row()], fetchedAt: new Date().toISOString() })
  getCachedLiveScores.mockResolvedValue({ scores: [], fetchedAt: null })
  getPlayFeedMock.mockResolvedValue([])
  leagueTeamFindMany.mockResolvedValue(claimedNflTeam)
})

describe('getLivePageData — roster read failure', () => {
  it('contains the throw, flags the roster, and does NOT blame the slate', async () => {
    const p2021 = Object.assign(new Error('The table `league_player_weekly_scores` does not exist'), {
      code: 'P2021',
    })
    weeklyScoreFindMany.mockRejectedValue(p2021)

    const data = await getLivePageData({ userId: 'u1', sport: 'NFL', scope: 'my' })

    expect(data.rosterFailed).toBe(true)
    // The slate loaded. Reporting it as failed is what sent two deploys the wrong way.
    expect(data.loadFailed).toBe(false)
  })

  it('keeps the already-fetched slate under scope=all', async () => {
    weeklyScoreFindMany.mockRejectedValue(new Error('P2021'))

    const data = await getLivePageData({ userId: 'u1', sport: 'NFL', scope: 'all' })

    expect(data.rosterFailed).toBe(true)
    // A roster fault must not destroy games we already have.
    expect(data.games).toHaveLength(1)
    expect(data.games[0]?.gameId).toBe('g1')
  })

  it('leaves scope=my with no games, which is why the flag must exist', async () => {
    weeklyScoreFindMany.mockRejectedValue(new Error('P2021'))

    const data = await getLivePageData({ userId: 'u1', sport: 'NFL', scope: 'my' })

    /*
     * This is the state that renders "None of your players are playing right
     * now". It is unavoidable — with no tie-ins there is nothing to show — which
     * is exactly why `rosterFailed` has to travel with it so the UI can say
     * something true instead.
     */
    expect(data.games).toHaveLength(0)
    expect(data.rosterFailed).toBe(true)
  })

  it('control: a successful roster read leaves rosterFailed false', async () => {
    weeklyScoreFindMany.mockResolvedValue([])

    const data = await getLivePageData({ userId: 'u1', sport: 'NFL', scope: 'all' })

    expect(data.rosterFailed).toBe(false)
    expect(data.loadFailed).toBe(false)
    expect(data.games).toHaveLength(1)
  })

  it('control: a signed-out request never reads rosters, so nothing can fail', async () => {
    weeklyScoreFindMany.mockRejectedValue(new Error('must not be called'))

    const data = await getLivePageData({ userId: null, sport: 'NFL', scope: 'all' })

    expect(data.rosterFailed).toBe(false)
    expect(data.hasRosterData).toBe(false)
    expect(weeklyScoreFindMany).not.toHaveBeenCalled()
  })
})
