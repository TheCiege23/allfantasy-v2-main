/**
 * Coverage for the automated weekly scoring cron: GET /api/redraft/score-sync.
 *
 * `vercel.json` schedules a cron GET to this route, but the route previously had
 * only a POST handler (manual sync) — so hands-off weekly scoring never ran. The
 * GET now enumerates every ACTIVE redraft season and runs the native pipeline
 * (syncPlayerWeeklyScoresForRedraftSeason -> recalculateMatchupsForSeasonWeek ->
 * updateStandings) per season, isolating per-season failures. These lock that
 * contract: per-season isolation, non-NFL skip, 200-on-partial-failure, and a
 * real 500 only when the run cannot start (enumeration query fails).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from './helpers/createMockNextRequest'

const requireCronAuthMock = vi.fn()
const requireAdminOrBearerMock = vi.fn()
const findManyMock = vi.fn() // prisma.redraftSeason.findMany
const syncMock = vi.fn()
const recalcMock = vi.fn()
const standingsMock = vi.fn()

vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: requireCronAuthMock }))
vi.mock('@/lib/adminAuth', () => ({ requireAdminOrBearer: requireAdminOrBearerMock }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findMany: findManyMock, findFirst: vi.fn().mockResolvedValue(null) },
    // legacy automation bridge (best-effort) — empty so it is a clean no-op
    league: { findMany: vi.fn().mockResolvedValue([]) },
    zombieLeague: { findMany: vi.fn().mockResolvedValue([]) },
    c2CLeague: { findMany: vi.fn().mockResolvedValue([]) },
    redraftMatchup: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))
vi.mock('@/lib/c2c/scoringEngine', () => ({ updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/survivor/gameStateMachine', () => ({ syncWeeklyScores: vi.fn() }))
vi.mock('@/lib/zombie/matchupCompletion', () => ({ checkAllMatchupsComplete: vi.fn() }))
vi.mock('@/lib/zombie/weeklyResolutionEngine', () => ({ runWeeklyResolution: vi.fn() }))
vi.mock('@/lib/zombie/ZombieLeagueConfig', () => ({ getZombieLeagueConfig: vi.fn() }))
vi.mock('@/lib/redraft/playerWeeklyScoreService', () => ({ syncPlayerWeeklyScoresForRedraftSeason: syncMock }))
vi.mock('@/lib/redraft/scoringEngine', () => ({ recalculateMatchupsForSeasonWeek: recalcMock }))
vi.mock('@/lib/redraft/standingsEngine', () => ({ updateStandings: standingsMock }))

const get = () => createMockNextRequest('http://localhost/api/redraft/score-sync')

describe('redraft score-sync GET — automated weekly scoring cron', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireCronAuthMock.mockReturnValue(true)
    syncMock.mockImplementation(async ({ seasonId }: { seasonId: string }) => ({
      seasonId,
      week: 3,
      scoresUpserted: 5,
      warnings: [],
    }))
    recalcMock.mockResolvedValue([])
    standingsMock.mockResolvedValue([])
  })

  it('enumerates active seasons and runs sync -> recalc -> standings per NFL season', async () => {
    findManyMock.mockResolvedValue([
      { id: 's1', leagueId: 'L1', sport: 'NFL', currentWeek: 3 },
      { id: 's2', leagueId: 'L2', sport: 'NFL', currentWeek: 3 },
    ])
    const { GET } = await import('@/app/api/redraft/score-sync/route')
    const res = await GET(get())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body).toMatchObject({ attempted: 2, succeeded: 2, failed: 0, skipped: 0 })
    expect(syncMock).toHaveBeenCalledTimes(2)
    expect(recalcMock).toHaveBeenCalledWith('s1', 3)
    expect(standingsMock).toHaveBeenCalledWith('s2', 3)
    expect(body.seasons).toContainEqual({ seasonId: 's1', ok: true, week: 3, scoresUpserted: 5 })
  })

  it('isolates per-season failures and keeps processing (200 with per-season detail)', async () => {
    findManyMock.mockResolvedValue([
      { id: 'good', leagueId: 'L1', sport: 'NFL', currentWeek: 3 },
      { id: 'bad', leagueId: 'L2', sport: 'NFL', currentWeek: 3 },
    ])
    syncMock.mockImplementation(async ({ seasonId }: { seasonId: string }) => {
      if (seasonId === 'bad') throw new Error('provider cache missing')
      return { seasonId, week: 3, scoresUpserted: 2, warnings: [] }
    })
    const { GET } = await import('@/app/api/redraft/score-sync/route')
    const res = await GET(get())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ attempted: 2, succeeded: 1, failed: 1 })
    const bad = (body.seasons as Array<Record<string, unknown>>).find((s) => s.seasonId === 'bad')!
    expect(bad.ok).toBe(false)
    expect(String(bad.error)).toContain('provider cache missing')
    expect(body.seasons).toContainEqual({ seasonId: 'good', ok: true, week: 3, scoresUpserted: 2 })
  })

  it('skips non-NFL seasons without pretending they synced', async () => {
    findManyMock.mockResolvedValue([
      { id: 'nba1', leagueId: 'L1', sport: 'NBA', currentWeek: 3 },
      { id: 'nfl1', leagueId: 'L2', sport: 'NFL', currentWeek: 3 },
    ])
    const { GET } = await import('@/app/api/redraft/score-sync/route')
    const res = await GET(get())
    const body = await res.json()
    expect(body).toMatchObject({ attempted: 2, succeeded: 1, skipped: 1 })
    expect(body.seasons).toContainEqual({ seasonId: 'nba1', ok: true, skipped: true, reason: 'non_nfl_sport' })
    expect(syncMock).toHaveBeenCalledTimes(1) // only the NFL season
  })

  it('returns a real 500 only when active-season enumeration fails (route-level fatal)', async () => {
    findManyMock.mockRejectedValue(new Error('db connection lost'))
    const { GET } = await import('@/app/api/redraft/score-sync/route')
    const res = await GET(get())
    expect(res.status).toBe(500)
    expect(syncMock).not.toHaveBeenCalled()
  })

  it('rejects unauthorized cron calls (no cron secret, not admin)', async () => {
    requireCronAuthMock.mockReturnValue(false)
    requireAdminOrBearerMock.mockResolvedValue({ ok: false, res: new Response('no', { status: 401 }) })
    const { GET } = await import('@/app/api/redraft/score-sync/route')
    const res = await GET(get())
    expect(res.status).toBe(401)
    expect(findManyMock).not.toHaveBeenCalled()
  })
})
