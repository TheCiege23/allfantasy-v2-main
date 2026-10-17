import { describe, expect, it } from 'vitest'

import { withDistinctLeagueNames } from '@/lib/chimmy/tools/boundedScan'
import { isLeagueNotStarted } from '@/lib/core-app/leagueNotStarted'

/*
 * 2026-09-28, TheCiege26: two "TheCiege26's 8-Team NFL Redraft League" and four
 * "TheCiege26's 12-Team NFL Redraft League" (all native, in setup). Named in full they were still
 * indistinguishable, and they were reported as "no players synced" when they had simply not drafted.
 */
describe('withDistinctLeagueNames', () => {
  it('suffixes only the colliding names, with the last four of the id (the league tile rule)', () => {
    const out = withDistinctLeagueNames([
      { id: 'efdfb9c3-564b-4589-bc7e-7a1e21660466', name: '8-Team Redraft' },
      { id: '9d0a700c-0e53-4a02-bb52-79cc12a80427', name: '8-Team Redraft' },
      { id: 'kbfl-id-0001', name: 'KBFL' },
    ])
    expect(out.map((l) => l.name)).toEqual(['8-Team Redraft · 0466', '8-Team Redraft · 0427', 'KBFL'])
  })

  it('keeps every other field, and leaves a list with no collisions untouched', () => {
    const rows = [{ id: 'a1', name: 'A', season: 2026 }, { id: 'b2', name: 'B', season: 2026 }]
    expect(withDistinctLeagueNames(rows)).toEqual(rows)
    const [first] = withDistinctLeagueNames([{ id: 'x1111', name: 'Same', season: 2026 }, { id: 'y2222', name: 'Same', season: 2026 }])
    expect(first).toEqual({ id: 'x1111', name: 'Same · 1111', season: 2026 })
  })
})

describe('isLeagueNotStarted', () => {
  it.each([
    [{ status: 'setup' }, true],
    [{ status: 'pre_draft' }, true],
    [{ status: 'PREDRAFT' }, true],
    [{ lifecycleState: 'drafting' }, true],
    [{ status: 'in_season', lifecycleState: 'pre_draft' }, true],
    [{ status: 'in_season', lifecycleState: 'in_season' }, false],
    [{ status: null, lifecycleState: null }, false],
  ])('%j → %s', (league, expected) => {
    expect(isLeagueNotStarted(league)).toBe(expected)
  })

  it('no league is not "not started"', () => {
    expect(isLeagueNotStarted(null)).toBe(false)
  })
})
