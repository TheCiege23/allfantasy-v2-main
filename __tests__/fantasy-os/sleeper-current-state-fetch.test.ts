// @vitest-environment node
/**
 * B6 — the CURRENT-STATE Sleeper fetch is BOUNDED: it never traverses the `previous_league_id` history
 * chain, never fetches drafts / per-week transactions, and never downloads the full NFL player map —
 * that heavy work is what made a deep-dynasty resync time out. It also proves the INITIAL import fetch is
 * UNCHANGED (still does the full historical fetch). Fully mocked at `global.fetch` — no live Sleeper.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchSleeperCurrentStateForImport } from '@/lib/league-import/sleeper/SleeperCurrentStateFetchService'
import { fetchSleeperLeagueForImport } from '@/lib/league-import/sleeper/SleeperLeagueFetchService'

const NEW = 'NEW123'
const OLD = 'OLD456'

let calls: string[] = []

function jsonRes(data: unknown) {
  return { ok: true, status: 200, json: async () => data } as unknown as Response
}
function notFound() {
  return { ok: false, status: 404, json: async () => null } as unknown as Response
}

/** Route table for a dynasty league NEW whose previous season is OLD. */
function respond(url: string, nflWeek: number): Response {
  if (url.endsWith(`/league/${NEW}`))
    return jsonRes({ league_id: NEW, name: 'HailShiva', season: '2026', total_rosters: 2, previous_league_id: OLD, roster_positions: ['QB'], scoring_settings: { rec: 1 }, settings: { type: 2 } })
  if (url.endsWith(`/league/${OLD}`))
    return jsonRes({ league_id: OLD, name: 'HailShiva', season: '2025', total_rosters: 2 })
  if (url.endsWith('/state/nfl')) return jsonRes({ season: '2026', week: nflWeek })
  if (url.endsWith(`/league/${NEW}/users`))
    return jsonRes([{ user_id: 'u1', display_name: 'A' }, { user_id: 'u2', display_name: 'B' }])
  if (url.endsWith(`/league/${NEW}/rosters`))
    return jsonRes([
      { roster_id: 1, owner_id: 'u1', players: ['p1'], starters: ['p1'], settings: { wins: 1, losses: 0, fpts: 100 } },
      { roster_id: 2, owner_id: 'u2', players: ['p2'], starters: ['p2'], settings: { wins: 0, losses: 1, fpts: 90 } },
    ])
  if (url.includes(`/league/${NEW}/traded_picks`)) return jsonRes([])
  if (url.includes(`/matchups/`)) return jsonRes([])
  if (url.includes('/drafts')) return jsonRes([])
  if (url.includes('/players/nfl')) return jsonRes({})
  if (url.includes('/transactions/')) return jsonRes([])
  return notFound()
}

function installFetch(nflWeek: number) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url))
    return respond(String(url), nflWeek)
  }))
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchSleeperCurrentStateForImport — bounded current-state read (B6)', () => {
  beforeEach(() => installFetch(0)) // offseason: NFL week 0

  it('never traverses history, drafts, transactions, or the full player map', async () => {
    const payload = await fetchSleeperCurrentStateForImport(NEW)
    expect(payload).not.toBeNull()
    expect(payload!.league?.league_id).toBe(NEW)
    expect(payload!.rosters).toHaveLength(2)
    // Historical sections are intentionally empty on a routine refresh.
    expect(payload!.previousSeasons).toEqual([])
    expect(payload!.transactions).toEqual([])
    expect(payload!.draftPicks).toEqual([])
    expect(payload!.playerMap).toEqual({})

    // The deep-dynasty timeout came from these — none may be fetched:
    expect(calls.some((u) => u.includes(`/league/${OLD}`))).toBe(false) // no previous_league_id chain
    expect(calls.some((u) => u.includes('/drafts'))).toBe(false)
    expect(calls.some((u) => u.includes('/players/nfl'))).toBe(false)
    expect(calls.some((u) => u.includes('/transactions/'))).toBe(false)
    // Offseason (week 0) → no matchup weeks fetched at all.
    expect(calls.some((u) => u.includes('/matchups/'))).toBe(false)

    // Only the core current-state endpoints, bounded.
    expect(calls.some((u) => u.endsWith(`/league/${NEW}`))).toBe(true)
    expect(calls.some((u) => u.endsWith(`/league/${NEW}/users`))).toBe(true)
    expect(calls.some((u) => u.endsWith(`/league/${NEW}/rosters`))).toBe(true)
    expect(calls.some((u) => u.includes(`/league/${NEW}/traded_picks`))).toBe(true)
    expect(calls.length).toBeLessThanOrEqual(6)
  })

  it('in-season, fetches only a bounded recent matchup window (never all 18 weeks)', async () => {
    installFetch(5) // NFL week 5
    await fetchSleeperCurrentStateForImport(NEW)
    const weeks = calls
      .filter((u) => u.includes('/matchups/'))
      .map((u) => Number(u.split('/matchups/')[1]))
      .sort((a, b) => a - b)
    expect(weeks).toEqual([3, 4, 5]) // window of 3 ending at the current week
    expect(weeks.length).toBeLessThanOrEqual(3)
  })
})

describe('fetchSleeperLeagueForImport — INITIAL import fetch is unchanged (still full/historical)', () => {
  beforeEach(() => installFetch(0))

  it('still traverses history, drafts, and the full player map', async () => {
    const payload = await fetchSleeperLeagueForImport(NEW)
    expect(payload).not.toBeNull()
    // Initial import MUST still do the heavy work the current-state refresh omits.
    expect(calls.some((u) => u.includes(`/league/${OLD}`))).toBe(true) // previous_league_id chain walked
    expect(calls.some((u) => u.includes('/drafts'))).toBe(true)
    expect(calls.some((u) => u.includes('/players/nfl'))).toBe(true)
    expect(calls.some((u) => u.includes('/transactions/'))).toBe(true)
  })
})
