/**
 * A player's position per scoring week (lib/bestball/weekPositions.ts): recorded when the week's weekly
 * score is written, following the roster while the week is open, frozen when it finalizes, and a no-op
 * until the player_week_positions migration is applied.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { freezeWeekPositions, readWeekPositions, recordWeekPositions, type WeekPositionDb } from '@/lib/bestball/weekPositions'

type Row = { playerId: string; sport: string; season: number; week: number; position: string | null; source: string; frozen: boolean }

/** An in-memory table with just the three calls the module makes. */
function table(initial: Row[] = []) {
  const rows = [...initial]
  const match = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && 'in' in (v as object) ? (v as { in: unknown[] }).in.includes(row[k as keyof Row]) : row[k as keyof Row] === v,
    )
  const db = {
    playerWeekPosition: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => match(r, where))),
      createMany: vi.fn(async ({ data }: { data: Omit<Row, 'frozen'>[] }) => {
        let count = 0
        for (const d of data) {
          if (rows.some((r) => r.playerId === d.playerId && r.sport === d.sport && r.season === d.season && r.week === d.week)) continue
          rows.push({ ...d, frozen: false })
          count += 1
        }
        return { count }
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const hit = rows.filter((r) => match(r, where))
        for (const r of hit) Object.assign(r, data)
        return { count: hit.length }
      }),
    },
  }
  return { db: db as unknown as WeekPositionDb, rows, calls: db.playerWeekPosition }
}

const WEEK = { sport: 'NFL', season: 2026, week: 9 }

describe('recording a week position', () => {
  let t: ReturnType<typeof table>
  beforeEach(() => {
    t = table()
  })

  it('creates a row per player with the position the week was scored with', async () => {
    const n = await recordWeekPositions(t.db, WEEK, new Map([['p1', 'TE'], ['p2', null]]))
    expect(n).toBe(2)
    expect(t.rows).toEqual([
      expect.objectContaining({ playerId: 'p1', position: 'TE', frozen: false, source: 'weekly_score_sync' }),
      expect.objectContaining({ playerId: 'p2', position: null, frozen: false }),
    ])
  })

  it('follows the roster while the week is open', async () => {
    await recordWeekPositions(t.db, WEEK, new Map([['p1', 'TE']]))
    await recordWeekPositions(t.db, WEEK, new Map([['p1', 'WR']]))
    expect((await readWeekPositions(t.db, WEEK, ['p1'])).get('p1')).toBe('WR')
  })

  it('never rewrites a frozen week: the re-listed TE stays a TE for the week that closed', async () => {
    await recordWeekPositions(t.db, WEEK, new Map([['p1', 'TE']]))
    expect(await freezeWeekPositions(t.db, WEEK, ['p1'])).toBe(1)
    expect(await recordWeekPositions(t.db, WEEK, new Map([['p1', 'WR']]))).toBe(0)
    expect((await readWeekPositions(t.db, WEEK, ['p1'])).get('p1')).toBe('TE')
  })

  it('writes nothing when nothing changed', async () => {
    await recordWeekPositions(t.db, WEEK, new Map([['p1', 'TE']]))
    t.calls.updateMany.mockClear()
    expect(await recordWeekPositions(t.db, WEEK, new Map([['p1', 'TE']]))).toBe(0)
    expect(t.calls.updateMany).not.toHaveBeenCalled()
  })

  it('keeps weeks and sports apart', async () => {
    await recordWeekPositions(t.db, WEEK, new Map([['p1', 'TE']]))
    await recordWeekPositions(t.db, { ...WEEK, week: 10 }, new Map([['p1', 'WR']]))
    expect((await readWeekPositions(t.db, WEEK, ['p1'])).get('p1')).toBe('TE')
    expect((await readWeekPositions(t.db, { ...WEEK, sport: 'NBA' }, ['p1'])).has('p1')).toBe(false)
  })
})

describe('before the migration is applied', () => {
  const missing = Object.assign(new Error('The table `public.player_week_positions` does not exist in the current database.'), { code: 'P2021' })

  it('a missing table reads as "nothing recorded" and writes nothing', async () => {
    const t = table()
    t.calls.findMany.mockRejectedValue(missing)
    t.calls.updateMany.mockRejectedValue(missing)
    expect(await recordWeekPositions(t.db, WEEK, new Map([['p1', 'TE']]))).toBe(0)
    expect(await freezeWeekPositions(t.db, WEEK, ['p1'])).toBe(0)
    expect((await readWeekPositions(t.db, WEEK, ['p1'])).size).toBe(0)
  })

  it('a client without the model at all (generated before it existed) is the same no-op', async () => {
    const db = {} as WeekPositionDb
    expect(await recordWeekPositions(db, WEEK, new Map([['p1', 'TE']]))).toBe(0)
    expect((await readWeekPositions(db, WEEK, ['p1'])).size).toBe(0)
  })

  it('any other database error still throws: an outage never reads as "no history"', async () => {
    const t = table()
    t.calls.findMany.mockRejectedValue(new Error("Can't reach database server"))
    await expect(readWeekPositions(t.db, WEEK, ['p1'])).rejects.toThrow(/reach database/)
  })
})
