import { describe, expect, it, vi } from 'vitest'
import type { League } from '@prisma/client'

import {
  deadlinePassed,
  deadlinePassedMessage,
  describeDeadlineAt,
  fromLocalInput,
  parseDeadlineAtInput,
  readDeadlineAt,
  toLocalInput,
} from '@/lib/trade-deadline/tradeDeadlineTime'
import { evaluateRedraftTradeDeadline, resolveTradeDeadlineStatus, serverWeekForTradeDeadline } from '@/lib/trade-deadline/tradeDeadlineWindow'
import { isPastTradeDeadline } from '@/lib/league-trade-engine/tradeSettingsResolver'

/** Week 11, Saturday 11:59 PM Eastern (EST, UTC-5) — 04:59Z the next day. */
const CLOSE = '2026-11-22T04:59:00.000Z'
const before = new Date('2026-11-22T04:58:00.000Z')
const after = new Date('2026-11-22T04:59:00.000Z')

describe('deadlinePassed', () => {
  const base = { inSeason: true, currentWeek: 11, deadlineWeek: 11 as number | null, deadlineAt: new Date(CLOSE) as Date | null }

  it('the close time closes trades from that exact moment', () => {
    expect(deadlinePassed({ ...base, now: before })).toEqual({ passed: false, by: null })
    expect(deadlinePassed({ ...base, now: after })).toEqual({ passed: true, by: 'time' })
  })

  it('whichever comes first: the week still closes trades when the time is later', () => {
    expect(deadlinePassed({ ...base, currentWeek: 12, deadlineAt: new Date('2026-12-30T00:00:00Z'), now: before })).toEqual({ passed: true, by: 'week' })
  })

  it('a time with no deadline week still closes trades', () => {
    expect(deadlinePassed({ ...base, deadlineWeek: null, now: after }).passed).toBe(true)
  })

  it('out of season nothing closes trades, a past close time included', () => {
    expect(deadlinePassed({ ...base, inSeason: false, currentWeek: null, now: after })).toEqual({ passed: false, by: null })
  })
})

describe('reading and saving the close time', () => {
  it('reads an ISO instant, and nothing else', () => {
    expect(readDeadlineAt({ trade_deadline_at: CLOSE })?.toISOString()).toBe(CLOSE)
    for (const s of [null, undefined, [], {}, { trade_deadline_at: '' }, { trade_deadline_at: 'soon' }, { trade_deadline_at: 5 }]) {
      expect(readDeadlineAt(s)).toBeNull()
    }
  })

  it('parses a save: ISO is normalised, null and empty clear, anything else is refused', () => {
    expect(parseDeadlineAtInput('2026-11-21T23:59:00-05:00')).toEqual({ ok: true, value: CLOSE })
    expect(parseDeadlineAtInput(null)).toEqual({ ok: true, value: null })
    expect(parseDeadlineAtInput('')).toEqual({ ok: true, value: null })
    expect(parseDeadlineAtInput('soon').ok).toBe(false)
    expect(parseDeadlineAtInput(7).ok).toBe(false)
  })

  it("the settings field is wall-clock time in the LEAGUE's timezone, both ways", () => {
    expect(toLocalInput(new Date(CLOSE), 'America/New_York')).toBe('2026-11-21T23:59')
    expect(fromLocalInput('2026-11-21T23:59', 'America/New_York')).toBe(CLOSE)
    expect(toLocalInput(new Date(CLOSE), 'America/Los_Angeles')).toBe('2026-11-21T20:59')
    expect(fromLocalInput('2026-11-21T20:59', 'America/Los_Angeles')).toBe(CLOSE)
    // Across the DST change: early October is EDT (UTC-4).
    expect(fromLocalInput('2026-10-10T23:59', 'America/New_York')).toBe('2026-10-11T03:59:00.000Z')
    expect(toLocalInput(null, 'America/New_York')).toBe('')
    expect(fromLocalInput('2026-11-21', 'America/New_York')).toBeNull()
  })

  it('names the moment in the refusal', () => {
    expect(describeDeadlineAt(new Date(CLOSE), 'America/New_York')).toBe('Sat, Nov 21, 11:59 PM EST')
    expect(deadlinePassedMessage({ by: 'time', deadlineWeek: 11, deadlineAt: new Date(CLOSE), timezone: 'America/New_York' })).toBe(
      'The trade deadline passed on Sat, Nov 21, 11:59 PM EST.',
    )
    expect(deadlinePassedMessage({ by: 'week', deadlineWeek: 11, deadlineAt: null, timezone: null })).toBe('Trade deadline passed after Week 11.')
  })
})

function deps(week: number, now: Date) {
  const findFirst = vi.fn(async () => ({ id: 'S', currentWeek: week, status: 'active' }))
  return { findFirst, deps: { prisma: { redraftSeason: { findFirst } } as never, resolveWeek: async () => week, now: () => now } }
}

const LEAGUE = { id: 'L', lifecycleState: 'in_season', platform: 'manual', timezone: 'America/New_York', settings: { trade_deadline_at: CLOSE } }

describe('the server-side deadline gate', () => {
  it('closes trades at the close time, inside the deadline week', async () => {
    expect((await resolveTradeDeadlineStatus(LEAGUE, 11, deps(11, before).deps)).passed).toBe(false)
    await expect(resolveTradeDeadlineStatus(LEAGUE, 11, deps(11, after).deps)).resolves.toMatchObject({ passed: true, by: 'time', deadlineWeek: 11 })
  })

  it('a close time alone is a deadline: the week is read and trades close', async () => {
    const d = deps(9, after)
    await expect(resolveTradeDeadlineStatus(LEAGUE, null, d.deps)).resolves.toMatchObject({ passed: true, by: 'time', deadlineWeek: null })
    expect(d.findFirst).toHaveBeenCalled()
    // ...and the week callers of isPastTradeDeadline need is returned, not null.
    await expect(serverWeekForTradeDeadline(LEAGUE, null, deps(9, after).deps)).resolves.toBe(9)
  })

  it('a league without settings is judged by the week alone, as before', async () => {
    const { settings: _s, ...noSettings } = LEAGUE
    expect((await resolveTradeDeadlineStatus(noSettings, 11, deps(11, after).deps)).passed).toBe(false)
  })

  it('the redraft path reads the close time from the league row', async () => {
    const findUnique = vi.fn(async () => ({ id: 'L', tradeDeadlineWeek: 11, lifecycleState: 'in_season', platform: null, settings: { trade_deadline_at: CLOSE }, timezone: 'America/New_York' }))
    const d = deps(11, after)
    const v = await evaluateRedraftTradeDeadline('L', { ...d.deps, leagueDb: { league: { findUnique } } as never })
    expect(v).toMatchObject({ passed: true, by: 'time' })
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ settings: true, timezone: true }) }))
    const always = await evaluateRedraftTradeDeadline('L', { ...d.deps, leagueDb: { league: { findUnique } } as never }, { alwaysResolveWeek: true })
    expect(always).toMatchObject({ passed: true, by: 'time' })
  })
})

describe('isPastTradeDeadline (the AF league engine and Chimmy)', () => {
  const league = (settings: unknown, tradeDeadlineWeek: number | null = 11) => ({ settings, tradeDeadlineWeek }) as unknown as League

  it('applies the close time in season', () => {
    expect(isPastTradeDeadline(league({ trade_deadline_at: CLOSE }), 11, before)).toBe(false)
    expect(isPastTradeDeadline(league({ trade_deadline_at: CLOSE }), 11, after)).toBe(true)
    expect(isPastTradeDeadline(league({ trade_deadline_at: CLOSE }, null), 4, after)).toBe(true)
  })

  it('no server week (no deadline applies, or out of season) never closes trades', () => {
    expect(isPastTradeDeadline(league({ trade_deadline_at: CLOSE }), null, after)).toBe(false)
  })

  it('the week rule is unchanged', () => {
    expect(isPastTradeDeadline(league({}), 11, after)).toBe(false)
    expect(isPastTradeDeadline(league({}), 12, after)).toBe(true)
    expect(isPastTradeDeadline(league({}, null), 16, after)).toBe(false)
  })
})
