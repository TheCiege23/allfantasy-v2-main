/**
 * Source selection for the multi-feed `SportsGame` table.
 *
 * The fixtures are sized from production, measured 2026-09-12 on the production Neon database (neondb):
 * NCAAF week 2 had `espn` 24 rows, `thesportsdb` 131, `api_sports` 126 and `cfbd` 303 (none of them
 * in progress); NFL week 1 had 15 rows in each of `espn`, `thesportsdb`, `rolling_insights` and
 * `api_sports`. Selecting ONE source for a whole call let the partial `espn` college slate replace the
 * complete one on the public scoreboard (#757, reverted in #762). These tests pin the per-week,
 * coverage-gated rule that replaced it.
 */
import { describe, expect, it } from 'vitest'

import { LIVE_SCORE_SOURCES, pickFreshestSourceRows } from '@/lib/scores/liveSourceSelection'

const NOW = Date.parse('2026-09-12T21:52:54.875Z')
const FRESH = new Date(NOW - 45_000)

type Row = {
  id: string
  source: string
  fetchedAt: Date | null
  season?: number | null
  week?: number | null
  seasonType?: string | null
}

function feed(source: string, count: number, week: number | null, extra: Partial<Row> = {}): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${source}-w${week}-${i}`,
    source,
    fetchedAt: FRESH,
    season: week == null ? null : 2026,
    week,
    ...extra,
  }))
}

function countBySource(out: Row[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const row of out) counts[row.source] = (counts[row.source] ?? 0) + 1
  return counts
}

describe('pickFreshestSourceRows — per-week, coverage-gated', () => {
  it('drops a partial ranked feed for a week it cannot cover (production NCAAF week 2: espn 24 of 131)', () => {
    const out = pickFreshestSourceRows(
      [...feed('espn', 24, 2), ...feed('thesportsdb', 131, 2), ...feed('api_sports', 126, 2)],
      NOW,
    )
    expect(countBySource(out)).toEqual({ thesportsdb: 131 })
  })

  it('keeps the preferred feed where it covers the week (production NFL week 1: espn 15 of 15)', () => {
    const out = pickFreshestSourceRows(
      [
        ...feed('espn', 15, 1),
        ...feed('thesportsdb', 15, 1),
        ...feed('rolling_insights', 15, 1),
        ...feed('api_sports', 15, 1),
      ],
      NOW,
    )
    expect(countBySource(out)).toEqual({ espn: 15 })
  })

  it('chooses per week, filling the weeks the preferred feed does not carry — and never two feeds in one week', () => {
    const out = pickFreshestSourceRows(
      [...feed('espn', 15, 1), ...feed('thesportsdb', 15, 1), ...feed('thesportsdb', 16, 2), ...feed('rolling_insights', 16, 2)],
      NOW,
    )
    expect(countBySource(out)).toEqual({ espn: 15, thesportsdb: 16 })
    for (const week of [1, 2]) {
      expect(new Set(out.filter((r) => r.week === week).map((r) => r.source)).size).toBe(1)
    }
  })

  it('does not let an unranked feed set the bar — cfbd has the most rows and no live status', () => {
    const out = pickFreshestSourceRows(
      [...feed('cfbd', 303, 2), ...feed('thesportsdb', 131, 2), ...feed('api_sports', 126, 2)],
      NOW,
    )
    expect(countBySource(out)).toEqual({ thesportsdb: 131 })
  })

  it('still returns an unranked feed when it is the only feed — last resort, as before', () => {
    expect(countBySource(pickFreshestSourceRows(feed('cfbd', 5, 2), NOW))).toEqual({ cfbd: 5 })
  })

  it('does not split a week on seasonType — thesportsdb writes NULL where espn writes regular', () => {
    const out = pickFreshestSourceRows(
      [...feed('espn', 15, 1, { seasonType: 'regular' }), ...feed('thesportsdb', 15, 1, { seasonType: null })],
      NOW,
    )
    expect(countBySource(out)).toEqual({ espn: 15 })
  })

  it('treats rows without season and week as one slice — the old whole-call behaviour', () => {
    const out = pickFreshestSourceRows([...feed('espn', 3, null), ...feed('thesportsdb', 50, null)], NOW)
    expect(countBySource(out)).toEqual({ thesportsdb: 50 })
  })

  it('pins the floor at 80% of the best ranked feed, on both sides of the line', () => {
    const atFloor = pickFreshestSourceRows([...feed('espn', 104, 3), ...feed('thesportsdb', 130, 3)], NOW)
    expect(countBySource(atFloor)).toEqual({ espn: 104 })
    const belowFloor = pickFreshestSourceRows([...feed('espn', 103, 3), ...feed('thesportsdb', 130, 3)], NOW)
    expect(countBySource(belowFloor)).toEqual({ thesportsdb: 130 })
  })

  it('preserves input order across weeks, because callers sort by kickoff first', () => {
    const input = [...feed('thesportsdb', 2, 2), ...feed('espn', 2, 1), ...feed('thesportsdb', 2, 1), ...feed('rolling_insights', 2, 2)]
    const out = pickFreshestSourceRows(input, NOW)
    expect(out.map((r) => r.id)).toEqual(['thesportsdb-w2-0', 'thesportsdb-w2-1', 'espn-w1-0', 'espn-w1-1'])
  })

  it('never lets a dead feed win on rank, however well it covers the week', () => {
    const out = pickFreshestSourceRows(
      [...feed('espn', 15, 1, { fetchedAt: new Date(NOW - 7 * 3600e3) }), ...feed('thesportsdb', 15, 1)],
      NOW,
    )
    expect(countBySource(out)).toEqual({ thesportsdb: 15 })
  })

  it('still ranks freshness above preference (2026-08-27): a feed that stopped reporting loses', () => {
    const out = pickFreshestSourceRows(
      [...feed('espn', 15, 1, { fetchedAt: new Date(NOW - 20 * 60e3) }), ...feed('thesportsdb', 15, 1)],
      NOW,
    )
    expect(countBySource(out)).toEqual({ thesportsdb: 15 })
  })

  it('exports exactly the ranked live feeds, in preference order, with cfbd excluded', () => {
    expect([...LIVE_SCORE_SOURCES]).toEqual(['espn', 'espn_live', 'thesportsdb', 'rolling_insights', 'api_sports'])
    expect(LIVE_SCORE_SOURCES).not.toContain('cfbd')
  })
})
