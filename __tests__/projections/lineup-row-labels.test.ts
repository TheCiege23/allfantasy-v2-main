/**
 * Lineup row labels (2026-11-27). The position rank reads "#32 PG", not "PG32", which the owner could
 * not tell was a rank. A daily league's tip-off time is passed through only when the schedule row has
 * one: `buildWeekKickoffMap` stands a time-less game at `<day>T04:00Z`, which is not a tip-off.
 */
import { describe, expect, it } from 'vitest'
import { readablePositionRank } from '@/lib/projections/dailySportFormLabels'
import { realStartIso } from '@/lib/projections/dailySportOutlook'

describe('readablePositionRank', () => {
  it.each([
    ['PG32', '#32 PG'],
    ['C1', '#1 C'],
    ['QB12', '#12 QB'],
    ['SP3', '#3 SP'],
    ['MID7', '#7 MID'],
    ['qb2', '#2 QB'],
  ])('%s reads %s', (raw, want) => {
    expect(readablePositionRank(raw)).toBe(want)
  })

  it('leaves an already readable or unknown label alone, and empty is nothing', () => {
    expect(readablePositionRank('#4 WR')).toBe('#4 WR')
    expect(readablePositionRank('top 10')).toBe('top 10')
    expect(readablePositionRank('')).toBeNull()
    expect(readablePositionRank(null)).toBeNull()
  })
})

describe('realStartIso', () => {
  it('passes a real tip-off through', () => {
    expect(realStartIso(new Date('2026-11-28T00:30:00.000Z'), '2026-11-27')).toBe('2026-11-28T00:30:00.000Z')
  })

  it('drops the no-start-time placeholder on the game day itself', () => {
    expect(realStartIso(new Date('2026-11-27T04:00:00.000Z'), '2026-11-27')).toBeNull()
  })

  it('keeps a real 8 pm Pacific game, which is 04:00Z on the NEXT UTC date', () => {
    expect(realStartIso(new Date('2026-11-28T04:00:00.000Z'), '2026-11-27')).toBe('2026-11-28T04:00:00.000Z')
  })

  it('nothing in, nothing out', () => {
    expect(realStartIso(null, '2026-11-27')).toBeNull()
    expect(realStartIso(new Date('nope'), '2026-11-27')).toBeNull()
  })
})
