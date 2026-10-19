import { describe, expect, it, vi } from 'vitest'

import {
  dailyLineupsActive,
  planDailyLineupSave,
  slotMapFromPlayerData,
  weekScoringDays,
  writeDailyLineupSave,
} from '@/lib/redraft/dailyLineupStore'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const week = weekScoringDays({ start: day('2026-10-20'), end: day('2026-10-27') })
const keys = (rows: { scoringDay: Date }[]) => [...new Set(rows.map((r) => r.scoringDay.toISOString().slice(0, 10)))]

const before = new Map([['lebron', 'SF'], ['bench1', 'bench']])
const after = new Map([['lebron', 'bench'], ['bench1', 'SF']])

describe('dailyLineupsActive', () => {
  const on = { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } }
  it('needs the lock type, the opt-in and a daily sport', () => {
    expect(dailyLineupsActive(on, 'NBA')).toBe(true)
    expect(dailyLineupsActive(on, 'NHL')).toBe(true)
    expect(dailyLineupsActive(on, 'MLB')).toBe(true)
    expect(dailyLineupsActive(on, 'NFL')).toBe(false)
    expect(dailyLineupsActive({ sportConfig: { lineupLockType: 'daily' } }, 'NBA')).toBe(false)
    expect(dailyLineupsActive({ sportConfig: { dailyLineupsEnabled: true } }, 'NBA')).toBe(false)
    expect(dailyLineupsActive(null, 'NBA')).toBe(false)
    expect(dailyLineupsActive(on, null)).toBe(false)
  })
})

describe('planDailyLineupSave', () => {
  it('writes the new lineup for today and every later day of the week', () => {
    const plan = planDailyLineupSave({ days: week, today: day('2026-10-22'), daysWithRows: new Set(), before, after })
    expect(plan.replaceDays.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26',
    ])
    const thursday = plan.rows.filter((r) => r.scoringDay.getTime() === day('2026-10-22').getTime())
    expect(thursday).toEqual([
      { scoringDay: day('2026-10-22'), playerId: 'lebron', slotType: 'bench' },
      { scoringDay: day('2026-10-22'), playerId: 'bench1', slotType: 'SF' },
    ])
  })

  it('fills earlier unsaved days with the lineup the save replaced', () => {
    const plan = planDailyLineupSave({ days: week, today: day('2026-10-22'), daysWithRows: new Set(), before, after })
    const tuesday = plan.rows.filter((r) => r.scoringDay.getTime() === day('2026-10-20').getTime())
    expect(tuesday).toEqual([
      { scoringDay: day('2026-10-20'), playerId: 'lebron', slotType: 'SF' },
      { scoringDay: day('2026-10-20'), playerId: 'bench1', slotType: 'bench' },
    ])
    expect(keys(plan.rows)).toHaveLength(7)
  })

  it('never rewrites an earlier day that already has rows', () => {
    const plan = planDailyLineupSave({
      days: week, today: day('2026-10-22'), daysWithRows: new Set(['2026-10-20', '2026-10-21']), before, after,
    })
    expect(keys(plan.rows)).not.toContain('2026-10-20')
    expect(keys(plan.rows)).not.toContain('2026-10-21')
    expect(plan.replaceDays.some((d) => d < day('2026-10-22'))).toBe(false)
  })

  it('a save for a future week writes every day of it from the new lineup', () => {
    const plan = planDailyLineupSave({ days: week, today: day('2026-10-18'), daysWithRows: new Set(), before, after })
    expect(plan.replaceDays).toHaveLength(7)
    expect(plan.rows.every((r) => r.slotType === after.get(r.playerId))).toBe(true)
  })
})

describe('slotMapFromPlayerData', () => {
  it('reads the engine lineup sections and skips players the roster no longer names', () => {
    const map = slotMapFromPlayerData(
      {
        starters: ['stale'],
        lineup_sections: { starters: [{ id: 'lebron' }], bench: [{ id: 'bench1' }], ir: [{ id: 'hurt' }] },
      },
      [
        { playerId: 'lebron', position: 'SF' },
        { playerId: 'bench1', position: 'PG' },
        { playerId: 'hurt', position: 'C' },
        { playerId: 'gone', position: 'SG' },
      ],
    )
    expect([...map]).toEqual([['lebron', 'SF'], ['bench1', 'bench'], ['hurt', 'ir']])
  })
})

describe('writeDailyLineupSave', () => {
  function fakeTx(existingDays: string[]) {
    return {
      redraftDailyLineup: {
        findMany: vi.fn(async () => existingDays.map((d) => ({ scoringDay: day(d) }))),
        deleteMany: vi.fn(async () => ({ count: 0 })),
        createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
      },
    }
  }

  it('clears today onward, then inserts the planned rows for the right roster and week', async () => {
    const tx = fakeTx(['2026-10-20'])
    const result = await writeDailyLineupSave(tx as never, {
      leagueId: 'L1', redraftRosterId: 'rd1', sport: 'NBA', season: 2026, week: 1, before, after,
      // 2026-10-22 15:00 ET
      now: new Date('2026-10-22T19:00:00.000Z'),
    })
    expect(tx.redraftDailyLineup.deleteMany).toHaveBeenCalledWith({
      where: { rosterId: 'rd1', scoringDay: { in: week.slice(2) } },
    })
    const data = (tx.redraftDailyLineup.createMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> }).data
    // Tue already saved; Wed backfilled from `before`; Thu–Mon from `after`. 6 days × 2 players.
    expect(result.written).toBe(12)
    expect(data.every((r) => r.rosterId === 'rd1' && r.leagueId === 'L1' && r.week === 1 && r.season === 2026)).toBe(true)
    expect(data.find((r) => (r.scoringDay as Date).getTime() === day('2026-10-21').getTime() && r.playerId === 'lebron')?.slotType).toBe('SF')
  })

  it('skips cleanly when the week has no calendar', async () => {
    const tx = fakeTx([])
    const result = await writeDailyLineupSave(tx as never, {
      leagueId: 'L1', redraftRosterId: 'rd1', sport: 'NBA', season: 1999, week: 1, before, after,
    })
    expect(result).toEqual({ written: 0, skipped: 'no week calendar' })
    expect(tx.redraftDailyLineup.createMany).not.toHaveBeenCalled()
  })
})
