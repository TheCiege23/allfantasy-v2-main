/**
 * One card per league the reader is actually in.
 *
 * 🛑 THE NUMBERS THESE RULES COME FROM, measured on production 2026-09-20. `leagues` is unique on
 * `(userId, platform, platformLeagueId, season)` where `userId` is the IMPORTER, so one Sleeper
 * league imported by four people is four rows — and a claimed team is written into every copy. A
 * loader that finds "my leagues" through `claimedByUserId` therefore sees one row per copy:
 *
 *     one real account   95 league rows -> 65 distinct leagues, 30 phantoms
 *     all accounts       340 reader/league pairs, 434 rows, 94 phantoms
 *
 * ⚠ AND THE OBVIOUS FIX DELETES REAL LEAGUES. 17 reader/league pairs own ZERO copies — they
 * claimed a team in a league someone else imported. "Keep only the row you own" removes those
 * leagues outright. The test for that case is the most important one in this file.
 */
import { describe, expect, it } from 'vitest'

import { collapseClaimedLeagues } from '@/lib/core-app/claimedLeagues'

const ME = 'user-me'
const d = (iso: string) => new Date(iso)

/** A claimed-team row, shaped like the loaders' `findMany` result. */
function row(over: {
  id: string
  plid?: string | null
  owner?: string | null
  updatedAt?: string
  extra?: string
}) {
  return {
    leagueId: over.id,
    extra: over.extra ?? '',
    league: {
      id: over.id,
      platformLeagueId: over.plid === undefined ? 'sleeper-1' : over.plid,
      userId: over.owner ?? 'someone-else',
      updatedAt: d(over.updatedAt ?? '2026-09-01T00:00:00Z'),
    },
  }
}

describe('collapseClaimedLeagues', () => {
  /* The KBFL shape: four copies, four importers, the reader claimed a team in all of them. */
  it('collapses every copy of one league into a single row', () => {
    const out = collapseClaimedLeagues(
      [
        row({ id: 'a', owner: 'importer-1' }),
        row({ id: 'b', owner: 'importer-2' }),
        row({ id: 'c', owner: ME }),
        row({ id: 'e', owner: 'importer-3' }),
      ],
      ME,
    )
    expect(out).toHaveLength(1)
  })

  it('keeps the copy the reader owns, wherever it appears in the list', () => {
    const out = collapseClaimedLeagues(
      [row({ id: 'a', owner: 'importer-1' }), row({ id: 'mine', owner: ME })],
      ME,
    )
    expect(out[0]!.league.id).toBe('mine')

    /* And when the owned copy comes FIRST, it must not be displaced by a later one. */
    const reversed = collapseClaimedLeagues(
      [row({ id: 'mine', owner: ME }), row({ id: 'a', owner: 'importer-1' })],
      ME,
    )
    expect(reversed[0]!.league.id).toBe('mine')
  })

  /*
   * 🛑 THE REGRESSION GUARD. 17 real reader/league pairs look exactly like this. A filter to
   * owned-only returns [] here and the league vanishes from that reader's board.
   */
  it('still returns a league when the reader owns none of its copies', () => {
    const out = collapseClaimedLeagues(
      [row({ id: 'a', owner: 'importer-1' }), row({ id: 'b', owner: 'importer-2' })],
      ME,
    )
    expect(out).toHaveLength(1)
    expect(['a', 'b']).toContain(out[0]!.league.id)
  })

  it('breaks an unowned tie by freshness, then by id, so two renders agree', () => {
    const byFreshness = collapseClaimedLeagues(
      [
        row({ id: 'stale', updatedAt: '2026-09-01T00:00:00Z' }),
        row({ id: 'fresh', updatedAt: '2026-09-19T00:00:00Z' }),
      ],
      ME,
    )
    expect(byFreshness[0]!.league.id).toBe('fresh')

    const sameInstant = '2026-09-10T00:00:00Z'
    const byId = collapseClaimedLeagues(
      [row({ id: 'zzz', updatedAt: sameInstant }), row({ id: 'aaa', updatedAt: sameInstant })],
      ME,
    )
    expect(byId[0]!.league.id).toBe('aaa')
  })

  /*
   * 🛑 BLANK PLATFORM IDS MUST NOT MERGE. Zero production rows carry one today, so this guards a
   * future case — but collapsing unrelated leagues into one card would be worse than the bug this
   * function fixes, and a shared '' key does exactly that.
   */
  it('never collapses two leagues that merely both lack a platform id', () => {
    const out = collapseClaimedLeagues(
      [row({ id: 'manual-1', plid: '' }), row({ id: 'manual-2', plid: null }), row({ id: 'manual-3', plid: '   ' })],
      ME,
    )
    expect(out).toHaveLength(3)
  })

  it('keeps distinct leagues distinct, and preserves first-seen order', () => {
    const out = collapseClaimedLeagues(
      [
        row({ id: 'x', plid: 'sleeper-9' }),
        row({ id: 'a', plid: 'sleeper-1', owner: 'importer-1' }),
        row({ id: 'b', plid: 'sleeper-1', owner: ME }),
        row({ id: 'y', plid: 'sleeper-5' }),
      ],
      ME,
    )
    expect(out.map((r) => r.league.platformLeagueId)).toEqual(['sleeper-9', 'sleeper-1', 'sleeper-5'])
    expect(out[1]!.league.id).toBe('b')
  })

  /* Every caller did this by hand before the helper existed; none should have to again. */
  it('drops rows with no league and survives an empty input', () => {
    const out = collapseClaimedLeagues(
      [{ leagueId: 'gone', league: null }, row({ id: 'a' })],
      ME,
    )
    expect(out).toHaveLength(1)
    expect(collapseClaimedLeagues([], ME)).toEqual([])
  })

  /* The caller's own fields ride through untouched — it gets its row back, not a copy of the league. */
  it('returns the caller’s row, not a rebuilt one', () => {
    const mine = row({ id: 'b', owner: ME, extra: 'carried' })
    const out = collapseClaimedLeagues([row({ id: 'a', owner: 'importer-1' }), mine], ME)
    expect(out[0]).toBe(mine)
    expect(out[0]!.extra).toBe('carried')
  })
})
