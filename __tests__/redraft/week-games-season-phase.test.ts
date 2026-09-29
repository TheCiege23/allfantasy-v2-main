/**
 * A stale feed's rows from ANOTHER PART OF THE SEASON must not decide a week's slate.
 *
 * Measured on production 2026-09-29: NFL week 3's last game (PHI at CHI, kickoff 00:15 UTC) was final
 * in espn, thesportsdb, rolling_insights and api_sports by 05:02, yet the finalizer refused
 * `games_not_final` for hours. `espn_live` stores every row with a NULL season type — the NFL
 * PRESEASON included, which reuses week numbers — so for week 3 it held 32 rows against every fresh
 * feed's 16. Coverage-before-rank disqualified the fresh feeds (16 < 0.8 × 32) and the week was
 * judged on `espn_live`'s three-hour-old `in_progress` row. The same read feeds the lineup lock.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { dropUnlabelledRowsFromAnotherPhase, readWeekGames } from '@/lib/redraft/weekGames'
import { readWeekSlate } from '@/lib/redraft/weekFinalizer'

const NOW = new Date('2026-09-29T05:05:00.000Z')

type Row = {
  status: string
  startTime: Date
  source: string
  fetchedAt: Date
  season: number
  week: number
  homeTeam: string
  awayTeam: string
  seasonType: string | null
}

/** 16 games from Thursday 00:15 UTC to the Monday 00:15 UTC game, the shape of a real NFL week. */
function week3(source: string, opts: { seasonType: string | null; fetchedAt: string; lastStatus?: string }): Row[] {
  const starts = [
    '2026-09-25T00:15:00Z',
    ...Array.from({ length: 13 }, (_, i) => `2026-09-27T${String(17 + (i % 4)).padStart(2, '0')}:0${i % 10}:00Z`),
    '2026-09-28T00:20:00Z',
    '2026-09-29T00:15:00Z',
  ]
  return starts.map((s, i) => ({
    status: i === starts.length - 1 ? (opts.lastStatus ?? 'final') : 'final',
    startTime: new Date(s),
    source,
    fetchedAt: new Date(opts.fetchedAt),
    season: 2026,
    week: 3,
    homeTeam: `H${i}`,
    awayTeam: `A${i}`,
    seasonType: opts.seasonType,
  }))
}

/** 16 preseason games that also carry week 3, unlabelled, as `espn_live` stores them. */
function preseasonWeek3(source: string, fetchedAt: string): Row[] {
  return Array.from({ length: 16 }, (_, i) => ({
    status: 'final',
    startTime: new Date(Date.UTC(2026, 7, 21 + (i % 4), 23, 0)),
    source,
    fetchedAt: new Date(fetchedAt),
    season: 2026,
    week: 3,
    homeTeam: `PH${i}`,
    awayTeam: `PA${i}`,
    seasonType: null,
  }))
}

/** The production shape of 2026-09-29 05:05 UTC. */
function productionRows(): Row[] {
  return [
    ...preseasonWeek3('espn_live', '2026-09-29T01:06:00Z'),
    ...week3('espn_live', { seasonType: null, fetchedAt: '2026-09-29T01:06:00Z', lastStatus: 'in_progress' }),
    ...week3('espn', { seasonType: 'regular', fetchedAt: '2026-09-29T05:02:00Z' }),
    ...week3('thesportsdb', { seasonType: 'regular', fetchedAt: '2026-09-29T05:02:00Z' }),
    ...week3('rolling_insights', { seasonType: 'regular', fetchedAt: '2026-09-29T05:02:00Z' }),
  ]
}

const fakePrisma = (rows: Row[]) => ({ sportsGame: { findMany: vi.fn(async () => rows) } }) as never

const args = { sport: 'NFL', season: 2026, week: 3, seasonType: 'regular' as const, now: NOW }

describe('a week slate is not decided by another phase of the season', () => {
  it('judges the week from a fresh feed when a stale one carries preseason rows under the same week', async () => {
    const slate = await readWeekSlate(fakePrisma(productionRows()), args)

    expect(slate.source).not.toBe('espn_live')
    expect(slate.games).toBe(16)
    expect(slate.unfinished).toBe(0)
    expect(slate.final).toBe(16)
  })

  it('the lineup lock reads the same fresh slate', async () => {
    const games = await readWeekGames(fakePrisma(productionRows()), args)

    expect(new Set(games.map((g) => g.source)).size).toBe(1)
    expect(games[0]!.source).not.toBe('espn_live')
    expect(games).toHaveLength(16)
    expect(games.every((g) => g.startTime!.getTime() >= Date.parse('2026-09-25T00:00:00Z'))).toBe(true)
  })

  it('still holds a genuinely unfinished week open', async () => {
    const rows = [
      ...preseasonWeek3('espn_live', '2026-09-29T01:06:00Z'),
      ...week3('espn', { seasonType: 'regular', fetchedAt: '2026-09-29T05:02:00Z', lastStatus: 'in_progress' }),
    ]
    const slate = await readWeekSlate(fakePrisma(rows), args)

    expect(slate.unfinished).toBe(1)
  })
})

describe('dropUnlabelledRowsFromAnotherPhase', () => {
  it('drops unlabelled rows a month before the week’s labelled games', () => {
    const kept = dropUnlabelledRowsFromAnotherPhase(productionRows())

    expect(kept.filter((r) => r.source === 'espn_live')).toHaveLength(16)
    expect(kept.some((r) => r.startTime.getUTCMonth() === 7)).toBe(false)
  })

  it('keeps an unlabelled game days before the first labelled one — a Thursday only that feed carries', () => {
    const labelledFromSunday = week3('espn', { seasonType: 'regular', fetchedAt: '2026-09-29T05:02:00Z' }).slice(1)
    const unlabelledThursday = week3('espn_live', { seasonType: null, fetchedAt: '2026-09-29T05:02:00Z' })[0]!

    const kept = dropUnlabelledRowsFromAnotherPhase([...labelledFromSunday, unlabelledThursday])

    expect(kept).toContain(unlabelledThursday)
  })

  it('changes nothing when no feed labels the week', () => {
    const rows = [...preseasonWeek3('espn_live', '2026-09-29T01:06:00Z'), ...week3('espn_live', { seasonType: null, fetchedAt: '2026-09-29T01:06:00Z' })]

    expect(dropUnlabelledRowsFromAnotherPhase(rows)).toHaveLength(32)
  })

  it('never drops a labelled row', () => {
    const labelledPreseason = preseasonWeek3('espn', '2026-09-29T05:02:00Z').map((r) => ({ ...r, seasonType: 'pre' }))
    const rows = [...labelledPreseason, ...week3('espn', { seasonType: 'regular', fetchedAt: '2026-09-29T05:02:00Z' })]

    expect(dropUnlabelledRowsFromAnotherPhase(rows)).toHaveLength(32)
  })
})
