import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

/*
 * The player card's five-week schedule strip, with later-week projections (2026-09-29).
 *
 * Before this, only the current week carried a number and the other four rows were a permanent '—'
 * under "later weeks show the fixture". Now a later week shows Sleeper's early line when one is
 * published, "not published yet" when Sleeper has not posted that week, and '—' otherwise — and the
 * sentence under the strip says which is which and as of when.
 *
 * Prisma is a default-empty proxy (the shape __tests__/player-card-league-foreign-ids.test.ts uses)
 * with fixtures for weeks 3–7; the future-week reader is mocked so this suite is about the consumer.
 */

type Fn = (...a: any[]) => any
const h = vi.hoisted(() => ({
  overrides: {} as Record<string, Record<string, Fn>>,
  readFuture: vi.fn(),
  latestWeek: vi.fn(),
  lookup: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => {
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          h.overrides[name]?.[method] ??
          (async () => (method === 'findMany' || method === 'groupBy' ? [] : method === 'count' ? 0 : null)),
      },
    )
  return {
    prisma: new Proxy({}, { get: (_t, name: string) => (name.startsWith('$') ? async () => [] : model(name)) }),
  }
})
vi.mock('@/lib/league-access', () => ({ memberLeaguePlatformIdsFor: vi.fn(async () => []) }))
vi.mock('@/lib/waiver-wire/watchlist-service', () => ({ isWatched: vi.fn(async () => false) }))
vi.mock('@/lib/follows/playerFollows', () => ({ followKeyFor: () => null, isFollowingPlayer: vi.fn(async () => null) }))
vi.mock('@/lib/injuries/injurySyncState', () => ({ readInjurySyncFreshness: vi.fn(async () => null) }))
vi.mock('@/lib/core-app/rosteredMarket', () => ({
  getRosteredMarket: vi.fn(async () => ({ byPlayerId: new Map(), leaguesCounted: 0 })),
}))
vi.mock('@/lib/core-app/playerProjections', () => ({
  latestProjectionWeek: h.latestWeek,
  lookupProjections: h.lookup,
  // The AF engine read the card also makes; no AF rows here, so the strip is what these tests assert.
  lookupAfEngineProjections: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/core-app/archivedTradeGrade', () => ({ gradeArchivedTradeRows: vi.fn(async () => new Map()) }))
vi.mock('@/lib/projections/futureWeekProjections', () => ({ readFutureWeekProjections: h.readFuture }))

import { getPlayerCard, loadSchedule, type ScheduleFutureWeeks } from '@/lib/core-app/playerCard'
import { scheduleProjectionNote } from '@/lib/core-app/scheduleProjectionNote'
import PlayerCardSheet from '@/components/core-app/player-card/PlayerCardSheet'
import type { PlayerCardData } from '@/lib/core-app/playerCard'
import type { FutureWeekLine, FutureWeekStatus } from '@/lib/projections/futureWeekProjections'

const HIM = '4046'
const ASOF = '2026-09-29T11:00:00.000Z'

/* Green Bay's weeks 3–7; one fixture per week is enough for the club's own row. */
const FIXTURES = [
  { week: 3, homeTeam: 'GB', awayTeam: 'DET' },
  { week: 4, homeTeam: 'CHI', awayTeam: 'GB' },
  { week: 5, homeTeam: 'GB', awayTeam: 'MIN' },
  { week: 6, homeTeam: 'LAR', awayTeam: 'GB' },
  { week: 7, homeTeam: 'GB', awayTeam: 'SEA' },
].map((g) => ({ ...g, startTime: new Date('2026-10-01T17:00:00Z'), seasonType: 'regular', venue: null }))

function futureLine(week: number, points: number): FutureWeekLine {
  return { playerId: HIM, week, projectedPoints: points, componentStats: null, opponent: null, asOf: ASOF, lineFetchedAt: ASOF, basis: 'sleeper-ppr' }
}

function futureFor(): ScheduleFutureWeeks {
  const weeks = new Map<number, FutureWeekStatus>([
    [4, { week: 4, state: 'published', confirmedAt: ASOF, changedAt: ASOF, rowCount: 900, stale: false, lastCheckFailed: false }],
    [5, { week: 5, state: 'published', confirmedAt: ASOF, changedAt: ASOF, rowCount: 900, stale: false, lastCheckFailed: false }],
    [6, { week: 6, state: 'not_published', confirmedAt: ASOF, stale: false, lastCheckFailed: false }],
    [7, { week: 7, state: 'unchecked', reason: 'Week 7 has not been checked yet.' }],
  ])
  // Week 5 is published but carries no line for him; a stray week-3 line must never be used.
  return { weeks, lines: new Map([[4, futureLine(4, 14.2)], [3, futureLine(3, 99)]]) }
}

beforeEach(() => {
  for (const k of Object.keys(h.overrides)) delete h.overrides[k]
  h.overrides.sportsGame = {
    findMany: async ({ where }: { where: { week: { gte: number; lte: number } } }) =>
      FIXTURES.filter((g) => g.week >= where.week.gte && g.week <= where.week.lte),
  }
  h.readFuture.mockReset()
  h.latestWeek.mockReset().mockResolvedValue({ season: '2026', week: 3 })
  h.lookup.mockReset().mockResolvedValue(new Map([[HIM, { playerId: HIM, projectedPoints: 5.1 }]]))
})

describe('loadSchedule with later-week projections', () => {
  it('gives every later week a number or a reason, and the current week keeps its own number', async () => {
    const { schedule } = await loadSchedule('GB', 2026, 3, 3, 5.1, 5, futureFor())
    if (!schedule.available) throw new Error('expected a schedule')
    expect(schedule.data.futureWeeks).toEqual({ enabled: true })
    expect(schedule.data.weeks).toEqual([
      { week: 3, opponent: 'DET', home: true, bye: false, projection: 5.1, projectionKind: 'current' },
      { week: 4, opponent: 'CHI', home: false, bye: false, projection: 14.2, projectionKind: 'future', futureStatus: 'published', projectionAsOf: ASOF },
      { week: 5, opponent: 'MIN', home: true, bye: false, projection: null, futureStatus: 'no_line', projectionAsOf: ASOF },
      { week: 6, opponent: 'LAR', home: false, bye: false, projection: null, futureStatus: 'not_published', projectionAsOf: ASOF },
      { week: 7, opponent: 'SEA', home: true, bye: false, projection: null, futureStatus: 'unchecked', projectionAsOf: null },
    ])
  })

  it('without future data the rows are exactly the earlier shape', async () => {
    const { schedule } = await loadSchedule('GB', 2026, 3, 3, 5.1)
    if (!schedule.available) throw new Error('expected a schedule')
    expect(schedule.data).toEqual({
      season: 2026,
      projectedWeek: 3,
      weeks: [
        { week: 3, opponent: 'DET', home: true, bye: false, projection: 5.1 },
        { week: 4, opponent: 'CHI', home: false, bye: false, projection: null },
        { week: 5, opponent: 'MIN', home: true, bye: false, projection: null },
        { week: 6, opponent: 'LAR', home: false, bye: false, projection: null },
        { week: 7, opponent: 'SEA', home: true, bye: false, projection: null },
      ],
    })
  })
})

describe('loadSchedule with the AF engine number as well', () => {
  it('puts AF on the current week only, never on a later week carrying Sleeper’s early line', async () => {
    const { schedule } = await loadSchedule('GB', 2026, 3, 3, 5.1, 5, futureFor(), 6.3)
    if (!schedule.available) throw new Error('expected a schedule')
    expect(schedule.data.weeks.map((w) => [w.week, w.projection, w.afProjection ?? null])).toEqual([
      [3, 5.1, 6.3],
      [4, 14.2, null],
      [5, null, null],
      [6, null, null],
      [7, null, null],
    ])
    // A later week never gains the field at all.
    expect(schedule.data.weeks.slice(1).some((w) => 'afProjection' in w)).toBe(false)
  })
})

describe('getPlayerCard wires the future read to the strip', () => {
  beforeEach(() => {
    h.overrides.sportsPlayer = {
      findFirst: async () => ({
        externalId: HIM, sleeperId: HIM, sport: 'NFL', name: 'Jayden Reed', position: 'WR', team: 'GB',
        number: null, imageUrl: null, age: null, height: null, weight: null, yearsExp: null, college: null,
      }),
      findMany: async () => [],
    }
  })

  it('asks for the four weeks after the current one, for this player, and renders them', async () => {
    const f = futureFor()
    h.readFuture.mockResolvedValue({
      available: true, season: '2026', afterWeek: 3, throughWeek: 7, weeks: f.weeks, lines: new Map([[HIM, f.lines]]),
    })
    const card = await getPlayerCard({ sport: 'NFL', sleeperId: HIM })
    expect(h.readFuture).toHaveBeenCalledWith(expect.objectContaining({ season: '2026', afterWeek: 3, throughWeek: 7, playerIds: [HIM], sport: 'NFL' }))
    if (!card?.schedule.available) throw new Error('expected a schedule')
    expect(card.schedule.data.weeks.map((w) => [w.week, w.projection, w.futureStatus ?? null])).toEqual([
      [3, 5.1, null],
      [4, 14.2, 'published'],
      [5, null, 'no_line'],
      [6, null, 'not_published'],
      [7, null, 'unchecked'],
    ])
  })

  it('an unavailable or failing future read leaves the strip as it always was', async () => {
    h.readFuture.mockResolvedValue({ available: false, reason: 'not switched on' })
    const off = await getPlayerCard({ sport: 'NFL', sleeperId: HIM })
    h.readFuture.mockRejectedValue(new Error('db down'))
    const failing = await getPlayerCard({ sport: 'NFL', sleeperId: HIM })
    for (const card of [off, failing]) {
      if (!card?.schedule.available) throw new Error('expected a schedule')
      expect(card.schedule.data.futureWeeks).toBeUndefined()
      expect(card.schedule.data.weeks.map((w) => w.projection)).toEqual([5.1, null, null, null, null])
      expect(card.schedule.data.weeks.some((w) => 'futureStatus' in w)).toBe(false)
    }
  })
})

describe('what the strip says', () => {
  it('keeps the old sentences when later weeks were not consulted', () => {
    expect(scheduleProjectionNote({ weeks: [], projectedWeek: 3 })).toBe(
      'Published baseline projections cover week 3 only; later weeks show the fixture. Your lineup view applies league scoring and current injury availability.'
    )
    expect(scheduleProjectionNote({ weeks: [], projectedWeek: null })).toBe('No projected week is published yet; these are fixtures.')
  })

  it('names which later weeks are published (as of when), not published, and not on file', async () => {
    const { schedule } = await loadSchedule('GB', 2026, 3, 3, 5.1, 5, futureFor())
    if (!schedule.available) throw new Error('expected a schedule')
    expect(scheduleProjectionNote(schedule.data)).toBe(
      "Week 3 is this week's published line. Weeks 4–5: Sleeper's early PPR lines, as of Sep 29. " +
        'Week 6: not published yet. Week 7: no line on file yet. ' +
        'Your lineup view applies league scoring and current injury availability.'
    )
  })

  it('renders each later week with its own value — number, "not published yet", or a dash', async () => {
    const { schedule } = await loadSchedule('GB', 2026, 3, 3, 5.1, 5, futureFor())
    if (!schedule.available) throw new Error('expected a schedule')
    const data: PlayerCardData = {
      context: 'universal',
      player: { externalId: HIM, sleeperId: HIM, sport: 'NFL', name: 'Jayden Reed', position: 'WR', team: 'GB', number: null, imageUrl: null },
      bio: { age: null, height: null, weight: null, yearsExp: null, college: null },
      market: { available: false, reason: 'no price' },
      ownership: { available: false, reason: 'too few leagues' },
      schedule,
      byeWeek: null,
      trades: { available: false, reason: 'no trades' },
      comps: { available: false, reason: 'no comps' },
      news: { available: false, reason: 'no news' },
      injury: { available: false, reason: 'none' },
      injuryFeed: { available: false, reason: 'none' },
      insight: null,
      league: null,
    } as PlayerCardData
    const { container } = render(
      <PlayerCardSheet
        subject={{ sport: 'NFL', sleeperId: HIM, name: 'Jayden Reed', position: 'WR' }}
        data={data}
        status="ready"
        onClose={() => {}}
        onOpen={() => {}}
      />
    )
    const pairs = [...container.querySelectorAll('.af-pc-row')].map((row) => ({
      k: row.querySelector('.af-pc-row-k')?.textContent?.trim() ?? '',
      v: row.querySelector('.af-pc-row-v')?.textContent?.trim() ?? '',
    }))
    expect(pairs).toContainEqual({ k: 'WK3 · vs DET', v: '5.1' })
    expect(pairs).toContainEqual({ k: 'WK4 · @ CHI', v: '14.2' })
    expect(pairs).toContainEqual({ k: 'WK5 · vs MIN', v: '—' })
    expect(pairs).toContainEqual({ k: 'WK6 · @ LAR', v: 'not published yet' })
    expect(pairs).toContainEqual({ k: 'WK7 · vs SEA', v: '—' })
    expect(container.textContent).toContain("Weeks 4–5: Sleeper's early PPR lines, as of Sep 29.")
  })
})
