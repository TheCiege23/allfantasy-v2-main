// @vitest-environment node
/**
 * Guillotine escapes (shareable moments, 2026-09-14): only from a chop that happened, measured
 * against the highest-scoring chopped team, within the league's danger margin — and refused when
 * the log and the scores cannot support the claim.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ rosterFind: vi.fn(), scoreFind: vi.fn(), config: vi.fn(), events: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { roster: { findFirst: h.rosterFind }, guillotinePeriodScore: { findMany: h.scoreFind } },
}))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ getGuillotineConfig: h.config }))
vi.mock('@/lib/guillotine/GuillotineEventLog', () => ({ getRecentEvents: h.events }))

import { chopsFromEvents, escapesFrom, getGuillotineEscapesForUser } from '@/lib/share/guillotineEscape'

const chop = (weekOrPeriod: number, choppedRosterIds: string[], commissionerOverride = false) => ({ weekOrPeriod, choppedRosterIds, commissionerOverride })
const s = (rosterId: string, weekOrPeriod: number, periodPoints: number) => ({ rosterId, weekOrPeriod, periodPoints })

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
})

describe('escapesFrom', () => {
  it('🛑 the margin is your points minus the HIGHEST chopped score that week, within the danger margin', () => {
    const out = escapesFrom({
      rosterId: 'me',
      chops: [chop(5, ['a', 'b'])],
      // `a` in another week and `c` (a survivor) must not move the line.
      scores: [s('me', 5, 91.24), s('a', 4, 99), s('a', 5, 80), s('b', 5, 88.04), s('c', 5, 140)],
      dangerMarginPoints: 10,
    })
    expect(out).toEqual([{ weekOrPeriod: 5, myPoints: 91.2, chopLine: 88, margin: 3.2, choppedCount: 2 }])
  })

  it('beating the chop by more than the danger margin is not an escape; exactly the margin is', () => {
    const scores = [s('me', 5, 100), s('a', 5, 90)]
    expect(escapesFrom({ rosterId: 'me', chops: [chop(5, ['a'])], scores, dangerMarginPoints: 9.9 })).toEqual([])
    expect(escapesFrom({ rosterId: 'me', chops: [chop(5, ['a'])], scores, dangerMarginPoints: 10 })).toHaveLength(1)
  })

  it('a margin of 0 is a real escape (the tiebreaker)', () => {
    expect(escapesFrom({ rosterId: 'me', chops: [chop(5, ['a'])], scores: [s('me', 5, 90), s('a', 5, 90)], dangerMarginPoints: 10 })[0]?.margin).toBe(0)
  })

  it('🛑 refuses: you were chopped, a commissioner override, your score or every chopped score missing, a negative margin', () => {
    const base = { rosterId: 'me', dangerMarginPoints: 10 }
    expect(escapesFrom({ ...base, chops: [chop(5, ['me', 'a'])], scores: [s('me', 5, 90), s('a', 5, 89)] })).toEqual([])
    expect(escapesFrom({ ...base, chops: [chop(5, ['a'], true)], scores: [s('me', 5, 90), s('a', 5, 89)] })).toEqual([])
    expect(escapesFrom({ ...base, chops: [chop(5, ['a'])], scores: [s('a', 5, 89)] })).toEqual([])
    expect(escapesFrom({ ...base, chops: [chop(5, ['a'])], scores: [s('me', 5, 90)] })).toEqual([])
    expect(escapesFrom({ ...base, chops: [chop(5, ['a'])], scores: [s('me', 5, 80), s('a', 5, 89)] })).toEqual([])
  })

  it('only the scores of THAT week count, and escapes come newest first', () => {
    const out = escapesFrom({
      rosterId: 'me',
      chops: [chop(3, ['a']), chop(6, ['b'])],
      scores: [s('me', 3, 95), s('a', 3, 90), s('a', 6, 200), s('me', 6, 101), s('b', 6, 99)],
      dangerMarginPoints: 10,
    })
    expect(out.map((e) => [e.weekOrPeriod, e.margin])).toEqual([[6, 2], [3, 5]])
  })
})

describe('chopsFromEvents', () => {
  it('parses the chop log, drops malformed rows, and merges a week logged twice (override sticks)', () => {
    expect(
      chopsFromEvents([
        { metadata: { weekOrPeriod: 5, choppedRosterIds: ['a'] } },
        { metadata: { weekOrPeriod: 5, choppedRosterIds: ['b', 'a'], commissionerOverride: true } },
        { metadata: { weekOrPeriod: 'six', choppedRosterIds: ['c'] } },
        { metadata: { weekOrPeriod: 7, choppedRosterIds: [] } },
        { metadata: null },
      ]),
    ).toEqual([{ weekOrPeriod: 5, choppedRosterIds: ['a', 'b'], commissionerOverride: true }])
    // An override on the FIRST row of the week still sticks when a later row omits it.
    expect(
      chopsFromEvents([
        { metadata: { weekOrPeriod: 5, choppedRosterIds: ['a'], commissionerOverride: true } },
        { metadata: { weekOrPeriod: 5, choppedRosterIds: ['b'] } },
      ])[0]?.commissionerOverride,
    ).toBe(true)
  })
})

describe('getGuillotineEscapesForUser', () => {
  it('🛑 reads YOUR roster in this league, the chop log, and only those weeks’ scores', async () => {
    h.rosterFind.mockResolvedValue({ id: 'me' })
    h.config.mockResolvedValue({ dangerMarginPoints: 10 })
    h.events.mockResolvedValue([{ metadata: { weekOrPeriod: 5, choppedRosterIds: ['a'] } }])
    h.scoreFind.mockResolvedValue([s('me', 5, 93.5), s('a', 5, 90)])
    expect(await getGuillotineEscapesForUser('lg1', 'u1')).toEqual([{ weekOrPeriod: 5, myPoints: 93.5, chopLine: 90, margin: 3.5, choppedCount: 1 }])
    expect(h.rosterFind.mock.calls[0][0].where).toEqual({ leagueId: 'lg1', platformUserId: 'u1' })
    expect(h.events).toHaveBeenCalledWith('lg1', { limit: 20, eventTypes: ['chop'] })
    expect(h.scoreFind.mock.calls[0][0].where).toEqual({ leagueId: 'lg1', weekOrPeriod: { in: [5] } })
  })

  it('the league’s own danger margin is used; missing falls back to 10', async () => {
    h.rosterFind.mockResolvedValue({ id: 'me' })
    h.events.mockResolvedValue([{ metadata: { weekOrPeriod: 5, choppedRosterIds: ['a'] } }])
    h.scoreFind.mockResolvedValue([s('me', 5, 96), s('a', 5, 90)])
    h.config.mockResolvedValue({ dangerMarginPoints: 5 })
    expect(await getGuillotineEscapesForUser('lg1', 'u1')).toEqual([])
    h.config.mockResolvedValue({ dangerMarginPoints: null })
    expect(await getGuillotineEscapesForUser('lg1', 'u1')).toHaveLength(1)
  })

  it('no roster, no guillotine config, or no chops: nothing, and no score read', async () => {
    h.config.mockResolvedValue({ dangerMarginPoints: 10 })
    h.events.mockResolvedValue([{ metadata: { weekOrPeriod: 5, choppedRosterIds: ['a'] } }])
    h.rosterFind.mockResolvedValue(null)
    expect(await getGuillotineEscapesForUser('lg1', 'u1')).toEqual([])
    h.rosterFind.mockResolvedValue({ id: 'me' })
    h.config.mockResolvedValue(null)
    expect(await getGuillotineEscapesForUser('lg1', 'u1')).toEqual([])
    h.config.mockResolvedValue({ dangerMarginPoints: 10 })
    h.events.mockResolvedValue([])
    expect(await getGuillotineEscapesForUser('lg1', 'u1')).toEqual([])
    expect(await getGuillotineEscapesForUser('', 'u1')).toEqual([])
    expect(h.scoreFind).not.toHaveBeenCalled()
  })
})
