import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Week-1 bug in one file.
 *
 * A bootstrapped season writes all 18 weeks as 0-0 rows before kickoff, so
 * `max(week)` answers "week 18" in August. These tests pin the rule that
 * survives that shape: inside the latest season on file, the current week is
 * the earliest one still carrying an unscored row.
 */

const { findFirstMock } = vi.hoisted(() => ({ findFirstMock: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { weeklyMatchup: { findFirst: findFirstMock } },
}))

import { resolveCurrentWeek, resolveCurrentWeekForLeague } from '@/lib/core-app/currentWeek'

/** Queue of responses, consumed in call order. */
function queue(...responses: unknown[]) {
  findFirstMock.mockReset()
  for (const r of responses) findFirstMock.mockResolvedValueOnce(r)
  findFirstMock.mockResolvedValue(null)
}

describe('resolveCurrentWeek', () => {
  beforeEach(() => findFirstMock.mockReset())

  it('picks week 1 on a fully bootstrapped, wholly unscored season', async () => {
    queue({ seasonYear: 2026 }, { week: 1 })
    expect(await resolveCurrentWeek(['sleeper-1'])).toEqual({ seasonYear: 2026, week: 1 })
  })

  it('advances to the first unplayed week once earlier weeks are scored', async () => {
    queue({ seasonYear: 2026 }, { week: 5 })
    expect(await resolveCurrentWeek(['sleeper-1'])).toEqual({ seasonYear: 2026, week: 5 })

    // The unplayed lookup must be ordered ascending — descending would return 18.
    const unplayedCall = findFirstMock.mock.calls[1][0]
    expect(unplayedCall.orderBy).toEqual({ week: 'asc' })
    expect(unplayedCall.where.pointsFor).toEqual({ lte: 0 })
    expect(unplayedCall.where.pointsAgainst).toEqual({ lte: 0 })
  })

  it('falls back to the last week when every week has been scored', async () => {
    queue({ seasonYear: 2025 }, null, { week: 17 })
    expect(await resolveCurrentWeek(['sleeper-1'])).toEqual({ seasonYear: 2025, week: 17 })
  })

  it('scopes the unplayed search to the latest season, never mixing seasons', async () => {
    queue({ seasonYear: 2026 }, { week: 1 })
    await resolveCurrentWeek(['a', 'b'])
    expect(findFirstMock.mock.calls[1][0].where.seasonYear).toBe(2026)
  })

  it('returns null with no rows and never queries on an empty id list', async () => {
    queue(null)
    expect(await resolveCurrentWeek(['sleeper-1'])).toBeNull()

    findFirstMock.mockReset()
    expect(await resolveCurrentWeek([])).toBeNull()
    expect(await resolveCurrentWeek([''])).toBeNull()
    expect(findFirstMock).not.toHaveBeenCalled()
  })

  it('survives a read failure by reporting nothing rather than throwing', async () => {
    findFirstMock.mockReset()
    /*
     * One throwing call, then a resolving default. Neither mockRejectedValue
     * nor a persistent throwing implementation works here: both leave a
     * rejected promise that nothing has attached a handler to yet, and vitest
     * attributes the unhandled rejection to whichever test is running.
     */
    findFirstMock.mockImplementationOnce(async () => {
      throw new Error('db down')
    })
    findFirstMock.mockResolvedValue(null)
    expect(await resolveCurrentWeek(['sleeper-1'])).toBeNull()
  })
})

describe('resolveCurrentWeekForLeague', () => {
  beforeEach(() => findFirstMock.mockReset())

  it('honours an explicitly requested week instead of inferring one', async () => {
    queue({ seasonYear: 2026, week: 12 })
    expect(await resolveCurrentWeekForLeague('sleeper-1', 12)).toEqual({
      seasonYear: 2026,
      week: 12,
    })
    expect(findFirstMock.mock.calls[0][0].where.week).toBe(12)
    // A pinned week is one lookup, not the inference chain.
    expect(findFirstMock).toHaveBeenCalledTimes(1)
  })

  it('infers the earliest unplayed week when none was requested', async () => {
    queue({ seasonYear: 2026 }, { week: 1 })
    expect(await resolveCurrentWeekForLeague('sleeper-1', null)).toEqual({
      seasonYear: 2026,
      week: 1,
    })
  })
})
