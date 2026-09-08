import { describe, expect, it } from 'vitest'

import { keepBestPerRealLeague, realLeagueKey } from '@/lib/core-app/realLeague'

/*
 * One row per REAL league, not per AllFantasy league row.
 *
 * ── The bug this closes ─────────────────────────────────────────────────────
 *
 * One Sleeper league produces one AF `leagues` row PER IMPORTING USER — two
 * members both connecting the same league is expected, not a duplicate import.
 * Every board keyed on `leagueTeam.claimedByUserId` therefore renders that
 * league once per AF row.
 *
 * Measured on production 2026-09-08 for the account that reported it:
 *
 *   claimed teams                             94
 *   distinct REAL leagues                     65
 *   leagues where they hold >1 AF row         21
 *   duplicate rows a board renders            29   (~45% inflation)
 *
 * Observed on the waivers board as "Parbur" twice and "Its gonna be Maye 26"
 * three times, with byte-identical add/drop/net-gain — which matches the AF row
 * counts for those two leagues exactly (2 and 3).
 *
 * ⚠ THE DEDUPE RUNS ON THE OUTPUT, NOT ON THE LEAGUE LIST. Picking one AF row
 * up front risks picking the STARVED twin: this estate already records that
 * imported activity attaches to whichever AF row the ingest cron reached first,
 * so a twin can be real but empty. Deduping produced rows means a twin that
 * yielded nothing simply is not there to win.
 */

type Row = { leagueId: string; platform: string | null; platformLeagueId: string | null; netGain: number }
const row = (leagueId: string, platformLeagueId: string | null, netGain: number, platform: string | null = 'sleeper'): Row =>
  ({ leagueId, platform, platformLeagueId, netGain })

const dedupe = (rows: Row[]) =>
  keepBestPerRealLeague(
    rows,
    (r) => r,
    // Total on purpose: higher gain wins, and a tie resolves on leagueId so the
    // result cannot depend on input order. See the helper's header.
    (a, b) => a.netGain > b.netGain || (a.netGain === b.netGain && a.leagueId < b.leagueId),
  )

describe('realLeagueKey', () => {
  it('keys on platform + platformLeagueId, case-insensitively on platform', () => {
    expect(realLeagueKey({ platform: 'Sleeper', platformLeagueId: '123', leagueId: 'a' })).toBe(
      realLeagueKey({ platform: 'sleeper', platformLeagueId: '123', leagueId: 'b' })
    )
  })

  /*
   * 🛑 THE SAME DIGITS ON TWO PLATFORMS ARE TWO LEAGUES. Provider ids are only
   * unique within a provider; collapsing across them would silently hide a real
   * league from a board.
   */
  it('does NOT collapse the same id across different platforms', () => {
    expect(realLeagueKey({ platform: 'sleeper', platformLeagueId: '123', leagueId: 'a' })).not.toBe(
      realLeagueKey({ platform: 'espn', platformLeagueId: '123', leagueId: 'b' })
    )
  })

  /*
   * 🛑 AND THIS IS THE ONE THAT WOULD DESTROY DATA IF GOT WRONG. A manual or
   * unlinked league has NO platformLeagueId. Keying those on the null would give
   * every one of them the same key and collapse ALL of them into a single row —
   * turning a de-duplication into a silent mass deletion from the board. With no
   * provider identity, an AF row IS the identity.
   */
  it('falls back to the AF league id when there is no platform id, so manual leagues never merge', () => {
    const a = realLeagueKey({ platform: 'manual', platformLeagueId: null, leagueId: 'lg-a' })
    const b = realLeagueKey({ platform: 'manual', platformLeagueId: null, leagueId: 'lg-b' })
    expect(a).not.toBe(b)
  })

  it('treats a blank platform id the same as a missing one', () => {
    const a = realLeagueKey({ platform: 'manual', platformLeagueId: '   ', leagueId: 'lg-a' })
    const b = realLeagueKey({ platform: 'manual', platformLeagueId: '', leagueId: 'lg-b' })
    expect(a).not.toBe(b)
  })

  /*
   * 🛑 SEASON IS PART OF THE KEY. Some providers reuse one league id across
   * years; merging those would silently hide a whole season, which is worse than
   * the duplicate this exists to remove. This came from the portfolio copy of
   * the rule and is kept in the unified one.
   */
  it('does NOT collapse two seasons of the same league id', () => {
    expect(realLeagueKey({ platform: 'sleeper', platformLeagueId: '9', season: 2025, leagueId: 'a' })).not.toBe(
      realLeagueKey({ platform: 'sleeper', platformLeagueId: '9', season: 2026, leagueId: 'b' })
    )
  })

  it('still collapses the same league id within one season', () => {
    expect(realLeagueKey({ platform: 'sleeper', platformLeagueId: '9', season: 2026, leagueId: 'a' })).toBe(
      realLeagueKey({ platform: 'sleeper', platformLeagueId: '9', season: 2026, leagueId: 'b' })
    )
  })
})

describe('keepBestPerRealLeague', () => {
  it('collapses twins of one real league to a single row', () => {
    const out = dedupe([row('af-1', '999', 19.0), row('af-2', '999', 19.0)])
    expect(out).toHaveLength(1)
  })

  it('collapses triplets too — three importers, one league', () => {
    const out = dedupe([row('af-1', '777', 18.1), row('af-2', '777', 18.1), row('af-3', '777', 18.1)])
    expect(out).toHaveLength(1)
  })

  it('keeps genuinely different leagues', () => {
    const out = dedupe([row('af-1', '111', 5), row('af-2', '222', 6)])
    expect(out).toHaveLength(2)
  })

  /*
   * ⚠ THE BEST ROW WINS, NOT THE FIRST. If one twin is the starved one it will
   * usually produce nothing at all — but where both produce, the reader should
   * see the stronger recommendation rather than whichever AF row sorted first.
   */
  it('keeps the highest-scoring twin', () => {
    const out = dedupe([row('af-low', '999', 3.2), row('af-high', '999', 19.0)])
    expect(out).toHaveLength(1)
    expect(out[0].leagueId).toBe('af-high')
  })

  /* A tie must not depend on input order, or the board flickers between loads. */
  it('breaks a tie deterministically, whichever order they arrive in', () => {
    const a = dedupe([row('af-b', '999', 10), row('af-a', '999', 10)])[0].leagueId
    const b = dedupe([row('af-a', '999', 10), row('af-b', '999', 10)])[0].leagueId
    expect(a).toBe(b)
  })

  it('never merges two manual leagues that both lack a platform id', () => {
    const out = dedupe([row('af-1', null, 5, 'manual'), row('af-2', null, 6, 'manual')])
    expect(out).toHaveLength(2)
  })

  it('is a no-op on an already-clean list', () => {
    const rows = [row('af-1', '1', 9), row('af-2', '2', 8), row('af-3', '3', 7)]
    expect(dedupe(rows).map((r) => r.leagueId)).toEqual(['af-1', 'af-2', 'af-3'])
  })

  it('handles an empty list', () => {
    expect(dedupe([])).toEqual([])
  })
})
