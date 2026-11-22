/**
 * The commissioner's "inactive manager" flag, graded (lib/commissioner-hub/inactiveFlagLedger.ts, 2026-11-20).
 *
 * Pinned:
 *   - a stretch is recorded once (ON CONFLICT DO NOTHING), only for rows shown as inactive with a last action;
 *   - two weeks on it is graded came_back / stayed_away from the manager's OWN actions; a vanished roster is
 *     closed as `gone` and left out of the record;
 *   - a missing table (migration not applied) is "nothing recorded", any other failure is not swallowed;
 *   - the record shows a rate only from 30 graded, and only under a native league's table.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, act } from '@testing-library/react'
import type { Prisma } from '@prisma/client'

const DAY = 86_400_000
const NOW = new Date('2026-11-20T12:00:00Z')
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)

const h = vi.hoisted(() => ({
  executed: [] as Array<{ sql: string; values: unknown[] }>,
  queried: [] as string[],
  due: [] as Array<{ id: string; leagueId: string; rosterId: string; lastActionAt: Date }>,
  counts: [] as Array<{ outcome: string | null; n: number }>,
  rosters: [] as Array<{ id: string; leagueId: string; platformUserId: string; managerUserId: null; redraftRosterId: null }>,
  own: new Map<string, Date | null>(),
  failWith: null as unknown,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/commissioner-hub/ownerLastAction', () => ({ loadOwnerLastActions: vi.fn(async () => h.own) }))
vi.mock('@/lib/prisma', () => {
  const text = (strings: readonly string[]) => strings.join('?')
  return {
    prisma: {
      $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        h.executed.push({ sql: text(strings), values })
        return values.length
      }),
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        if (h.failWith) throw h.failWith
        const sql = text(strings)
        h.queried.push(sql)
        return sql.includes('GROUP BY "outcome"') ? h.counts : h.due
      }),
      roster: { findMany: vi.fn(async () => h.rosters) },
    },
  }
})

import { gradeInactiveFlags, inactiveFlagOutcome, recordInactiveFlags } from '@/lib/commissioner-hub/inactiveFlagLedger'
import { inactiveFlagView, readInactiveFlagView } from '@/lib/commissioner-hub/inactiveFlagView'

/** The SQL of the last write, nested fragments (the VALUES rows) flattened. */
const lastWrite = () => {
  const w = h.executed[h.executed.length - 1]!
  const flat: unknown[] = []
  for (const v of w.values) {
    const sql = v as Prisma.Sql
    if (sql && Array.isArray((sql as { values?: unknown }).values)) flat.push(...sql.values)
    else flat.push(v)
  }
  return { sql: w.sql, values: flat }
}

beforeEach(() => {
  h.executed = []
  h.queried = []
  h.due = []
  h.counts = []
  h.rosters = []
  h.own = new Map()
  h.failWith = null
})

describe('inactiveFlagOutcome', () => {
  it('came back only on an own action AFTER the one the stretch was idle from', () => {
    expect(inactiveFlagOutcome(ago(20), ago(3))).toBe('came_back')
    expect(inactiveFlagOutcome(ago(20), ago(20))).toBe('stayed_away')
    expect(inactiveFlagOutcome(ago(20), null)).toBe('stayed_away')
  })
})

describe('recordInactiveFlags', () => {
  it('records only the rows shown as inactive, once per stretch', async () => {
    await recordInactiveFlags('L1', [
      { rosterId: 'r1', status: 'inactive', lastActionAt: ago(20).toISOString() },
      { rosterId: 'r2', status: 'at_risk', lastActionAt: ago(5).toISOString() },
      { rosterId: 'r3', status: 'inactive', lastActionAt: null },
    ])
    const w = lastWrite()
    expect(w.sql).toMatch(/INSERT INTO commissioner_inactive_flags/)
    expect(w.sql).toMatch(/ON CONFLICT \("leagueId", "rosterId", "lastActionAt"\) DO NOTHING/)
    expect(w.values).toContain('r1')
    expect(w.values).not.toContain('r2')
    expect(w.values).not.toContain('r3')
  })

  it('writes nothing when nobody is inactive', async () => {
    expect(await recordInactiveFlags('L1', [{ rosterId: 'r2', status: 'active', lastActionAt: ago(1).toISOString() }])).toBe(0)
    expect(h.executed).toHaveLength(0)
  })
})

describe('gradeInactiveFlags', () => {
  it('grades two-week-old stretches from the manager’s own actions and tallies the year', async () => {
    h.due = [
      { id: 'f1', leagueId: 'L1', rosterId: 'r1', lastActionAt: ago(30) },
      { id: 'f2', leagueId: 'L1', rosterId: 'r2', lastActionAt: ago(30) },
      { id: 'f3', leagueId: 'L1', rosterId: 'gone-roster', lastActionAt: ago(30) },
    ]
    h.rosters = [
      { id: 'r1', leagueId: 'L1', platformUserId: 'u1', managerUserId: null, redraftRosterId: null },
      { id: 'r2', leagueId: 'L1', platformUserId: 'u2', managerUserId: null, redraftRosterId: null },
    ]
    h.own = new Map([['r1', ago(4)], ['r2', null]])
    h.counts = [{ outcome: 'came_back', n: 10 }, { outcome: 'stayed_away', n: 25 }, { outcome: 'gone', n: 2 }, { outcome: null, n: 4 }]

    const tally = await gradeInactiveFlags(NOW)
    // Only stretches at least two weeks old are read.
    expect(h.queried[0]).toMatch(/"outcome" IS NULL AND "flaggedAt" <=/)
    const w = lastWrite()
    expect(w.sql).toMatch(/UPDATE commissioner_inactive_flags/)
    expect(w.values).toEqual(expect.arrayContaining(['f1', 'came_back', 'f2', 'stayed_away', 'f3', 'gone']))
    // `gone` is closed but never counted either way.
    expect(tally).toEqual({ graded: 35, stayedAway: 25, pending: 4 })
  })

  it('a missing table is "nothing recorded"; any other failure is the caller’s', async () => {
    h.failWith = Object.assign(new Error('relation does not exist'), { code: 'P2010', meta: { code: '42P01' } })
    expect(await gradeInactiveFlags(NOW)).toBeNull()
    h.failWith = Object.assign(new Error('syntax error'), { code: 'P2010', meta: { code: '42601' } })
    await expect(gradeInactiveFlags(NOW)).rejects.toThrow('syntax error')
  })
})

describe('the view', () => {
  it('shows a rate only from 30 graded, and survives the trip to the client', () => {
    expect(inactiveFlagView({ graded: 40, stayedAway: 30, pending: 1 })).toEqual({ graded: 40, stayedAway: 30, ratePct: 75 })
    expect(inactiveFlagView({ graded: 29, stayedAway: 20, pending: 0 })?.ratePct).toBeNull()
    expect(inactiveFlagView({ graded: 0, stayedAway: 0, pending: 3 })).toBeNull()
    expect(readInactiveFlagView({ graded: 40, stayedAway: 30, ratePct: 75 })).toEqual({ graded: 40, stayedAway: 30, ratePct: 75 })
    expect(readInactiveFlagView({ graded: 4, stayedAway: 9, ratePct: null })).toBeNull()
  })
})

describe('under the manager table', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  const ROWS = [
    { rosterId: 'r1', managerName: 'pat', teamName: 'Pats', avatarUrl: null, lineupsSet: null, expectedStarters: null, moves: 0, trades: 0, faabRemaining: null, lastActionAt: ago(20).toISOString(), status: 'inactive' as const },
  ]

  async function show(flagRecord: boolean) {
    const { __resetAdviceRecordForTests } = await import('@/components/core-app/useAdviceRecord')
    __resetAdviceRecordForTests()
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ record: null, inactiveFlags: { graded: 40, stayedAway: 30, ratePct: 75 } }) }))
    vi.stubGlobal('fetch', fetchMock)
    const { default: ManagerHealthTable } = await import('@/components/commish/ManagerHealthTable')
    render(<ManagerHealthTable rows={ROWS} flagRecord={flagRecord} />)
    await act(async () => {})
    return fetchMock
  }

  it('a native league shows how the flag has held up', async () => {
    await show(true)
    expect(screen.getByTestId('manager-health-flag-record').textContent).toMatch(
      /of 40 managers AllFantasy flagged inactive in the past year, 30 \(75%\) still had done nothing of their own two weeks later/,
    )
  })

  it('an imported league shows nothing and never asks', async () => {
    const fetchMock = await show(false)
    expect(screen.queryByTestId('manager-health-flag-record')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
