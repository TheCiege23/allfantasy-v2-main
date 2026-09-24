/**
 * One Sleeper fetch per (team, season) across a tick, not one per season being scored.
 *
 * 🛑 THIS CALL SPENT 95% OF THE SLEEPER BUDGET AND THE DAMAGE LANDED SOMEWHERE ELSE.
 *
 * `fetchSleeperTeamDefenseSeason` asks for a team's WHOLE SEASON (`grouping=week`) and the
 * caller extracts one week, so the identical payload was refetched once per team PER SEASON
 * BEING SCORED, every tick. Measured on production 2026-09-24, from the minute the first native
 * league advanced to week 2 and gave the live tick a week to score:
 *
 *     01:21Z  128 calls   (32 teams x 4 seasons)
 *     01:23Z  128
 *     ...     every 2 minutes  =  3,840/hour against a 1,000/hour cap
 *     01:35Z   76          budget exhausted
 *
 * The cap is per PROVIDER, so `stats/nfl/week` then went dark too, the week-stats fetch returned
 * an empty map, and the week finalizer refused with `stat_coverage_below_floor` — naming the
 * roster when the cause was this function's quota.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workers/rate-limit-manager', () => ({
  rateLimitManager: {
    canCall: vi.fn(async () => true),
    recordCall: vi.fn(async () => undefined),
  },
}))

const SEASON_PAYLOAD = { '1': { sack: 3, int: 1, pts_allow: 17 }, '2': { sack: 1, pts_allow: 24 } }

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules()
  fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => SEASON_PAYLOAD }))
  vi.stubGlobal('fetch', fetchSpy)
  // A generous window, so the test measures the memo and not the clock.
  process.env.AF_TEAM_DEFENSE_MEMO_MS = '600000'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.AF_TEAM_DEFENSE_MEMO_MS
})

async function loadProvider() {
  return import('@/lib/redraft/teamDefenseProvider')
}

describe('fetchSleeperTeamDefenseSeason — per-season fanout', () => {
  it('fetches one team once, however many seasons ask for it', async () => {
    const { fetchSleeperTeamDefenseSeason } = await loadProvider()

    // Four seasons scoring the same week is what produced 32 -> 128 in production.
    const results = await Promise.all([
      fetchSleeperTeamDefenseSeason('KC', 2026, 'regular'),
      fetchSleeperTeamDefenseSeason('KC', 2026, 'regular'),
      fetchSleeperTeamDefenseSeason('KC', 2026, 'regular'),
      fetchSleeperTeamDefenseSeason('KC', 2026, 'regular'),
    ])

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    for (const r of results) expect(r).toEqual(SEASON_PAYLOAD)
  })

  it('keeps distinct teams, seasons and season types apart', async () => {
    const { fetchSleeperTeamDefenseSeason } = await loadProvider()

    await fetchSleeperTeamDefenseSeason('KC', 2026, 'regular')
    await fetchSleeperTeamDefenseSeason('BUF', 2026, 'regular')
    await fetchSleeperTeamDefenseSeason('KC', 2025, 'regular')
    await fetchSleeperTeamDefenseSeason('KC', 2026, 'post')

    expect(fetchSpy).toHaveBeenCalledTimes(4)
  })

  /**
   * ⚠ ONLY A SUCCESS IS CACHED. Storing a miss would turn one transient outage into a window of
   * "this team has no defence" for every league — the weather-geocode precedent in CLAUDE.md.
   */
  it('does not cache a failure', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    const { fetchSleeperTeamDefenseSeason } = await loadProvider()

    expect(await fetchSleeperTeamDefenseSeason('KC', 2026, 'regular')).toBeNull()
    expect(await fetchSleeperTeamDefenseSeason('KC', 2026, 'regular')).toBeNull()

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('expires, so a live week is not served from a stale payload', async () => {
    process.env.AF_TEAM_DEFENSE_MEMO_MS = '0'
    const { fetchSleeperTeamDefenseSeason } = await loadProvider()

    await fetchSleeperTeamDefenseSeason('KC', 2026, 'regular')
    await fetchSleeperTeamDefenseSeason('KC', 2026, 'regular')

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
