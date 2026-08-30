/**
 * One row per league SERIES, not one per season.
 *
 * 🛑 THIS FUNCTION WAS A NO-OP FOR ITS ENTIRE LIFE. Its doc promised exactly this behaviour and
 * keyed on `platform:platformLeagueId` — but Sleeper mints a NEW league id every season, so the
 * six seasons of "AFC Dreaming!" carry six different ids and never grouped. Measured on the
 * live payload: 557 entries in, 557 out.
 *
 * The chain that DOES identify a series is `previous_league_id`, persisted as `LeagueSeason`
 * rows. That table held no chains until 2026-08-29 — every league had a single current-season
 * row, because the walk was a floating promise that died with the import response. Once that
 * was fixed and backfilled (78 rows -> 294) the map became usable, and the same payload
 * collapses 557 -> 374.
 *
 * ⚠ THE MAP IS OPTIONAL AND THE DEFAULT MUST NOT MOVE. A dozen surfaces read this list and none
 * of them asked for their rows to start disappearing, so the no-map path is asserted as hard as
 * the grouping.
 */
import { describe, expect, it } from 'vitest'

import { collapseLeagueSeasons } from '@/lib/dashboard/get-dashboard-league-list'

/** Six Sleeper ids, one series — the real shape of "AFC Dreaming!" 2021-2026. */
const SERIES = [
  { id: 'a', name: 'AFC Dreaming!', platform: 'sleeper', platformLeagueId: 's2021', season: 2021 },
  { id: 'b', name: 'AFC Dreaming!', platform: 'sleeper', platformLeagueId: 's2022', season: 2022 },
  { id: 'c', name: 'AFC Dreaming!', platform: 'sleeper', platformLeagueId: 's2026', season: 2026 },
]
const CHAIN = new Map([
  ['s2021', 'afc-series'],
  ['s2022', 'afc-series'],
  ['s2026', 'afc-series'],
])

describe('collapseLeagueSeasons — default behaviour is unchanged', () => {
  it('groups nothing without a series map, because each season has its own Sleeper id', () => {
    const out = collapseLeagueSeasons([...SERIES])
    expect(out).toHaveLength(3)
  })

  it('still collapses rows that genuinely share a platformLeagueId', () => {
    const dupes = [
      { id: 'x', platform: 'sleeper', platformLeagueId: 'same', season: 2025 },
      { id: 'y', platform: 'sleeper', platformLeagueId: 'same', season: 2026 },
    ]
    const out = collapseLeagueSeasons(dupes)
    expect(out).toHaveLength(1)
    expect(out[0]!.id).toBe('y') // newest season wins
  })
})

describe('collapseLeagueSeasons — with the previous_league_id chain', () => {
  it('collapses a whole series to its newest season', () => {
    const out = collapseLeagueSeasons([...SERIES], CHAIN)
    expect(out).toHaveLength(1)
    expect(out[0]!.season).toBe(2026)
    expect(out[0]!.id).toBe('c')
  })

  it('keeps a series whose newest season is NOT the current one', () => {
    /*
     * ⚠ THE WHOLE POINT. The client-side season filter this replaces cut to one global season
     * and hid 234 leagues outright — every league with no current-season edition. Measured
     * after the change: 208 of those come back.
     */
    const ended = [
      { id: 'p', platform: 'sleeper', platformLeagueId: 'e2024', season: 2024 },
      { id: 'q', platform: 'sleeper', platformLeagueId: 'e2025', season: 2025 },
    ]
    const chain = new Map([['e2024', 'ended-series'], ['e2025', 'ended-series']])
    const out = collapseLeagueSeasons([...SERIES, ...ended], new Map([...CHAIN, ...chain]))
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.season).sort()).toEqual([2025, 2026])
  })

  it('leaves a league alone when its chain has not been walked', () => {
    /*
     * Backfill coverage is partial: an entry with no LeagueSeason row falls back to the
     * per-season key rather than being guessed into somebody else's series.
     */
    const unknown = { id: 'z', platform: 'sleeper', platformLeagueId: 'never-walked', season: 2026 }
    const out = collapseLeagueSeasons([...SERIES, unknown], CHAIN)
    expect(out).toHaveLength(2)
    expect(out.some((r) => r.id === 'z')).toBe(true)
  })

  it('never merges two different series', () => {
    const other = { id: 'o', platform: 'sleeper', platformLeagueId: 'o2026', season: 2026 }
    const out = collapseLeagueSeasons(
      [...SERIES, other],
      new Map([...CHAIN, ['o2026', 'other-series']]),
    )
    expect(out).toHaveLength(2)
  })

  it('passes through rows with no provider identity, untouched', () => {
    /* AF-native and tournament rows have nothing to group on and must never be grouped. */
    const native = [
      { id: 'n1', platform: null, platformLeagueId: null, season: 2026 },
      { id: 'n2', platform: null, platformLeagueId: null, season: 2026 },
    ]
    const out = collapseLeagueSeasons([...(native as never[]), ...SERIES], CHAIN)
    expect(out).toHaveLength(3) // both natives + one collapsed series
  })
})
