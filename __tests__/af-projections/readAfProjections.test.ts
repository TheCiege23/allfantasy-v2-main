/**
 * The DB-first list reader for `AFProjectionSnapshot`.
 *
 * Two properties carry this file, and both fail SILENTLY if broken: picking the right row when a
 * player has several, and never turning a missing rest-of-season into a zero.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { aFProjectionSnapshot: { findMany: h.findMany, findFirst: h.findFirst } },
}))

import { listAfProjections, newestProjectionSeason } from '@/lib/af-projections/readAfProjections'

const row = (over: Record<string, unknown> = {}) => ({
  playerId: 'p1',
  playerName: 'Test Back',
  position: 'RB',
  sport: 'NFL',
  season: 2025,
  week: null,
  afProjection: 14.2,
  baselineProjection: 15.0,
  weatherAdjustment: -0.8,
  rosProjection: 198.8,
  rosWeeksRemaining: 14,
  confidenceLevel: 'high',
  adjustmentReason: 'Wind above 18mph at kickoff.',
  isOutdoorGame: true,
  computedAt: new Date('2026-09-02T07:53:00Z'),
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  h.findFirst.mockResolvedValue({ season: 2025 })
  h.findMany.mockResolvedValue([row()])
})

describe('season resolution', () => {
  it('reads the newest season rather than assuming the calendar year', async () => {
    /*
     * ⚠ NOT `new Date().getFullYear()`. The compute cron silently wrote nothing for 13 days while
     * reporting success — defaulting to the current year would have returned an empty list and
     * read as "no players projected" rather than "we are looking at the wrong year".
     */
    h.findFirst.mockResolvedValue({ season: 2025 })
    const out = await listAfProjections({ sport: 'NFL' })
    expect(out.season).toBe(2025)
    expect(h.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ season: 2025 }),
    }))
  })

  it('returns season null and no rows when the table holds nothing for the sport', async () => {
    h.findFirst.mockResolvedValue(null)
    const out = await listAfProjections({ sport: 'NFL' })
    expect(out).toEqual({ rows: [], season: null })
    // And it must not have run the list query at all.
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('honours an explicit season without looking one up', async () => {
    await listAfProjections({ sport: 'NFL', season: 2024 })
    expect(h.findFirst).not.toHaveBeenCalled()
    expect(h.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ season: 2024 }),
    }))
  })

  it('newestProjectionSeason returns null rather than throwing on an empty table', async () => {
    h.findFirst.mockResolvedValue(null)
    expect(await newestProjectionSeason('NFL')).toBeNull()
  })
})

describe('🛑 one player, several rows', () => {
  it('keeps the FIRST row per player and drops the rest', async () => {
    /*
     * The unique key includes week and eventId, so a player has a season baseline plus a row per
     * scored week. Rendering all of them shows the same player five times at five numbers.
     * Ordering is done in SQL (week desc, computedAt desc), so "first seen" is "best informed".
     */
    h.findMany.mockResolvedValue([
      row({ playerId: 'p1', week: 3, afProjection: 18.1 }),
      row({ playerId: 'p1', week: null, afProjection: 14.2 }),
      row({ playerId: 'p2', week: null, afProjection: 16.0, playerName: 'Other Back' }),
    ])
    const { rows } = await listAfProjections({ sport: 'NFL', week: 3 })
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.playerId)).toEqual(['p1', 'p2'])
    // p1's week-scoped row won, not the baseline.
    expect(rows.find((r) => r.playerId === 'p1')!.afProjection).toBe(18.1)
  })

  it('sorts by the per-game number AFTER dedupe', async () => {
    /*
     * Sorting only in SQL would rank a player by whichever of his rows happened to be largest,
     * rather than by the one actually shown.
     */
    h.findMany.mockResolvedValue([
      row({ playerId: 'a', week: 3, afProjection: 5, playerName: 'A' }),
      row({ playerId: 'a', week: null, afProjection: 99, playerName: 'A' }),
      row({ playerId: 'b', week: 3, afProjection: 20, playerName: 'B' }),
    ])
    const { rows } = await listAfProjections({ sport: 'NFL', week: 3 })
    expect(rows.map((r) => r.playerName)).toEqual(['B', 'A'])
  })

  it('over-fetches so the dedupe cannot starve the page', async () => {
    await listAfProjections({ sport: 'NFL', limit: 50 })
    const take = h.findMany.mock.calls[0][0].take
    expect(take).toBeGreaterThan(50)
  })
})

describe('🛑 a missing rest-of-season stays null', () => {
  it('never coerces a null rosProjection to 0', async () => {
    /*
     * The schema says it outright: null means "not computed", and 0 is a real claim the value
     * engine acts on. The census found this null on all 19,556 rows before the writer was fixed.
     */
    h.findMany.mockResolvedValue([row({ rosProjection: null, rosWeeksRemaining: null })])
    const { rows } = await listAfProjections({ sport: 'NFL' })
    expect(rows[0].rosProjection).toBeNull()
    expect(rows[0].rosWeeksRemaining).toBeNull()
    /*
     * Also asserted by TYPE, so the field cannot start carrying a numeric sentinel (0, -1) that
     * still fails `toBeNull()` but breaks every consumer's `x == null` branch.
     */
    expect(typeof rows[0].rosProjection).not.toBe('number')
  })

  it('keeps a genuine zero as zero', async () => {
    // A real 0 is a different claim from a missing one, and both must survive the read intact.
    h.findMany.mockResolvedValue([row({ rosProjection: 0, rosWeeksRemaining: 0 })])
    const { rows } = await listAfProjections({ sport: 'NFL' })
    expect(rows[0].rosProjection).toBe(0)
  })
})

describe('filters', () => {
  it('matches position case-insensitively and ignores "All"', async () => {
    await listAfProjections({ sport: 'NFL', position: 'rb' })
    expect(h.findMany.mock.calls[0][0].where.position).toEqual({ equals: 'rb', mode: 'insensitive' })

    h.findMany.mockClear()
    await listAfProjections({ sport: 'NFL', position: 'All' })
    expect(h.findMany.mock.calls[0][0].where.position).toBeUndefined()
  })

  it('takes the week-scoped row OR the baseline when a week is given', async () => {
    await listAfProjections({ sport: 'NFL', week: 4 })
    expect(h.findMany.mock.calls[0][0].where.OR).toEqual([{ week: 4 }, { week: null }])
  })

  it('takes ONLY the baseline when no week is given', async () => {
    await listAfProjections({ sport: 'NFL' })
    expect(h.findMany.mock.calls[0][0].where.week).toBeNull()
    expect(h.findMany.mock.calls[0][0].where.OR).toBeUndefined()
  })

  it('uppercases the sport and refuses an empty one', async () => {
    await listAfProjections({ sport: 'nfl' })
    expect(h.findMany.mock.calls[0][0].where.sport).toBe('NFL')

    h.findMany.mockClear()
    expect(await listAfProjections({ sport: '   ' })).toEqual({ rows: [], season: null })
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('clamps the limit rather than trusting it', async () => {
    const { rows } = await listAfProjections({ sport: 'NFL', limit: 100000 })
    expect(h.findMany.mock.calls[0][0].take).toBeLessThanOrEqual(600)
    expect(rows.length).toBeLessThanOrEqual(200)
  })
})
