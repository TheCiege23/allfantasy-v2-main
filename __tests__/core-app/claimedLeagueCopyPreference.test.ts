/**
 * Which copy of a duplicated league the trades board keeps.
 *
 * `leagues.userId` is the IMPORTER, so one Sleeper league imported by four people is four rows,
 * and a claimed team is written into every copy. A loader that finds "my leagues" through
 * `claimedByUserId` therefore sees one row per copy — measured on production 2026-09-20 as 95
 * rows for 65 distinct leagues on one real account, 30 phantoms.
 *
 * 🛑 THE KEY AND THE COLLAPSE ARE NOT TESTED HERE BECAUSE THEY ARE NOT THIS BOARD'S.
 * `lib/core-app/realLeague.ts` owns both and has its own suite; this file covers only the part
 * that is genuinely the board's — which copy to prefer. That split is deliberate: this board
 * briefly shipped a private second implementation of the whole rule, keyed on `platformLeagueId`
 * alone, which merges a Sleeper and an ESPN league sharing a numeric id and merges two seasons of
 * one league. Two implementations of one rule is the bug.
 */
import { describe, expect, it } from 'vitest'

import {
  claimedRowIdentity,
  keepBestPerRealLeague,
  preferImportedCopy,
} from '@/lib/core-app/realLeague'

const ME = 'user-me'

function copy(over: { id: string; owner?: string | null; updatedAt?: string; season?: number }) {
  return {
    leagueId: over.id,
    league: {
      id: over.id,
      platform: 'sleeper',
      platformLeagueId: 'sleeper-1',
      season: over.season ?? 2026,
      userId: over.owner ?? 'someone-else',
      updatedAt: new Date(over.updatedAt ?? '2026-09-01T00:00:00Z'),
    },
  }
}

/*
 * The board's REAL wiring — both halves imported from the loader, not restated here.
 *
 * ⚠ AN EARLIER DRAFT OF THIS FILE REBUILT `identify` INLINE, which tests a copy of the wiring and
 * would have gone green with `season` dropped from the loader. The season assertion below is only
 * worth anything because this function is the one production calls.
 */
const collapse = (rows: ReturnType<typeof copy>[]) =>
  keepBestPerRealLeague(rows, claimedRowIdentity, preferImportedCopy(ME))

describe('preferImportedCopy + claimedRowIdentity', () => {
  it('keeps the copy the reader imported, wherever it sits in the list', () => {
    expect(collapse([copy({ id: 'theirs' }), copy({ id: 'mine', owner: ME })])[0]!.league.id).toBe('mine')
    expect(collapse([copy({ id: 'mine', owner: ME }), copy({ id: 'theirs' })])[0]!.league.id).toBe('mine')
  })

  /*
   * 🛑 THE REGRESSION GUARD. 17 real reader/league pairs own ZERO copies. "Keep only the row you
   * own" returns nothing for them and the league vanishes from their board.
   */
  it('still returns a league when the reader owns none of its copies', () => {
    const out = collapse([copy({ id: 'a' }), copy({ id: 'b' })])
    expect(out).toHaveLength(1)
    expect(['a', 'b']).toContain(out[0]!.league.id)
  })

  it('breaks an unowned tie by freshness, then by id, so two renders agree', () => {
    expect(
      collapse([
        copy({ id: 'stale', updatedAt: '2026-09-01T00:00:00Z' }),
        copy({ id: 'fresh', updatedAt: '2026-09-19T00:00:00Z' }),
      ])[0]!.league.id,
    ).toBe('fresh')

    const t = '2026-09-10T00:00:00Z'
    expect(collapse([copy({ id: 'zzz', updatedAt: t }), copy({ id: 'aaa', updatedAt: t })])[0]!.league.id).toBe('aaa')
  })

  it('collapses four copies of one league to one', () => {
    expect(
      collapse([copy({ id: 'a' }), copy({ id: 'b' }), copy({ id: 'c', owner: ME }), copy({ id: 'd' })]),
    ).toHaveLength(1)
  })

  /*
   * 🛑 THE TRAP THE REPLACED HELPER FELL INTO, asserted through the board's own wiring rather than
   * taken on trust from `realLeague`'s suite. Two seasons of one league are two leagues, and
   * merging them hides a whole season — silently, since an absent season stringifies to '' for
   * every row rather than failing.
   */
  it('does not merge two seasons of the same league', () => {
    expect(collapse([copy({ id: 'y2026', season: 2026 }), copy({ id: 'y2025', season: 2025 })])).toHaveLength(2)
  })
})
