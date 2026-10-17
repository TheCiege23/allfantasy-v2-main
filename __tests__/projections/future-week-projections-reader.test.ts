import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
// The reader is always handed its store here; this only keeps the default deps from building a client.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  FUTURE_WEEKS_NOT_ENABLED,
  FUTURE_WEEK_STALE_MS,
  readFutureWeekProjections,
  type FutureWeekReadDeps,
} from '@/lib/projections/futureWeekProjections'
import type { FutureWeekCheckRow, FutureWeekLineRow } from '@/lib/projections/futureWeekProjectionStore'

const NOW = Date.parse('2026-09-29T12:00:00Z')
const CONFIRMED = new Date('2026-09-29T11:00:00Z')

function check(week: number, over: Partial<FutureWeekCheckRow> = {}): FutureWeekCheckRow {
  return {
    week,
    status: 'published',
    rowCount: 900,
    payloadHash: 'h',
    anchorWeek: 4,
    checkedAt: CONFIRMED,
    confirmedAt: CONFIRMED,
    changedAt: new Date('2026-09-28T11:00:00Z'),
    lastError: null,
    ...over,
  }
}

function line(week: number, playerId = '4046', points = 12.5): FutureWeekLineRow {
  return { playerId, week, projectedPoints: points, stats: { pts_ppr: points, rec: 5 }, opponent: 'CHI', fetchedAt: new Date('2026-09-28T11:00:00Z') }
}

function deps(checks: FutureWeekCheckRow[], lines: FutureWeekLineRow[], ready = true) {
  const readChecks = vi.fn(async () => checks)
  const readLines = vi.fn(async () => lines)
  const d: FutureWeekReadDeps = { ready: vi.fn(async () => ready), store: { readChecks, readLines }, now: () => NOW }
  return { d, readChecks, readLines }
}

const ASK = { season: '2026', afterWeek: 4, throughWeek: 8, playerIds: ['4046'] }

describe('readFutureWeekProjections', () => {
  it('before the migration: unavailable, says so, and never queries', async () => {
    const { d, readChecks, readLines } = deps([], [], false)
    expect(await readFutureWeekProjections(ASK, d)).toEqual({ available: false, reason: FUTURE_WEEKS_NOT_ENABLED })
    expect(readChecks).not.toHaveBeenCalled()
    expect(readLines).not.toHaveBeenCalled()
  })

  it('a sport with no weekly feed is unavailable without a query', async () => {
    const { d, readChecks } = deps([], [])
    const r = await readFutureWeekProjections({ ...ASK, sport: 'NCAAF' }, d)
    expect(r.available).toBe(false)
    expect(readChecks).not.toHaveBeenCalled()
  })

  it('gives every asked-for week a status, and every line its as-of', async () => {
    const { d, readChecks } = deps(
      [check(5), check(6, { status: 'not_published', rowCount: 0, payloadHash: null }), check(7, { status: null, confirmedAt: null, lastError: 'x' })],
      [line(5)],
    )
    const r = await readFutureWeekProjections(ASK, d)
    if (!r.available) throw new Error('expected available')

    expect(readChecks).toHaveBeenCalledWith(expect.objectContaining({ sport: 'NFL', season: '2026', afterWeek: 4, throughWeek: 8, source: 'sleeper' }))
    expect([...r.weeks.keys()]).toEqual([5, 6, 7, 8])
    expect(r.weeks.get(5)).toMatchObject({ state: 'published', confirmedAt: CONFIRMED.toISOString(), stale: false, lastCheckFailed: false })
    expect(r.weeks.get(6)).toMatchObject({ state: 'not_published', confirmedAt: CONFIRMED.toISOString() })
    expect(r.weeks.get(7)).toMatchObject({ state: 'unchecked' })
    expect(r.weeks.get(8)).toMatchObject({ state: 'unchecked', reason: 'Week 8 has not been checked yet.' })

    expect(r.lines.get('4046')?.get(5)).toEqual({
      playerId: '4046',
      week: 5,
      projectedPoints: 12.5,
      componentStats: { pts_ppr: 12.5, rec: 5 },
      opponent: 'CHI',
      asOf: CONFIRMED.toISOString(),
      lineFetchedAt: '2026-09-28T11:00:00.000Z',
      basis: 'sleeper-ppr',
    })
  })

  it('never returns the current week or an earlier one, whatever the store hands back', async () => {
    const { d } = deps([check(3), check(4), check(5)], [line(3), line(4), line(5)])
    const r = await readFutureWeekProjections(ASK, d)
    if (!r.available) throw new Error('expected available')
    expect([...r.weeks.keys()].every((w) => w > 4)).toBe(true)
    expect([...(r.lines.get('4046')?.keys() ?? [])]).toEqual([5])
  })

  it('drops a line filed under a week whose check does not say published', async () => {
    const { d } = deps([check(5, { status: 'not_published' })], [line(5)])
    const r = await readFutureWeekProjections(ASK, d)
    if (!r.available) throw new Error('expected available')
    expect(r.lines.get('4046')).toBeUndefined()
  })

  it('flags a stale confirmation and a failed latest check', async () => {
    const old = new Date(NOW - FUTURE_WEEK_STALE_MS - 60_000)
    const { d } = deps([check(5, { confirmedAt: old, checkedAt: new Date(NOW - 1000), lastError: 'Sleeper returned no board' })], [])
    const r = await readFutureWeekProjections(ASK, d)
    if (!r.available) throw new Error('expected available')
    expect(r.weeks.get(5)).toMatchObject({ state: 'published', stale: true, lastCheckFailed: true })
  })
})
