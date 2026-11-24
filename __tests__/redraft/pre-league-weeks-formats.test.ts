/**
 * Pre-league weeks (lib/redraft/preLeagueWeeks.ts) are a head-to-head round-robin for the weeks a late
 * league missed. Survivor and guillotine have no head-to-head schedule, so they get none: a Survivor
 * league drafted in NBA week 6 showed five weeks of invented games on its Matchup tab.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const st = vi.hoisted(() => ({ survivorMode: false, guillotine: false, created: [] as unknown[] }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findUnique: vi.fn(async () => ({ id: 'S', leagueId: 'L', sport: 'NBA', currentWeek: 6 })) },
    league: {
      findUnique: vi.fn(async (args: { select: Record<string, boolean> }) => ('survivorMode' in args.select ? { survivorMode: st.survivorMode } : { settings: {} })),
      update: vi.fn(async () => ({})),
    },
    redraftRoster: { findMany: vi.fn(async () => [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }]) },
    redraftMatchup: {
      findMany: vi.fn(async () => []),
      createMany: vi.fn(async (args: { data: unknown[] }) => { st.created.push(...args.data); return { count: args.data.length } }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ isGuillotineLeague: vi.fn(async () => st.guillotine) }))
vi.mock('@/lib/redraft/scoringEngine', () => ({ recalculateMatchupsForSeasonWeek: vi.fn(async () => undefined) }))
vi.mock('@/lib/redraft/playerWeeklyScoreService', () => ({ syncPlayerWeeklyScoresForRedraftSeason: vi.fn(async () => undefined) }))
vi.mock('@/lib/redraft/standingsEngine', () => ({ updateStandings: vi.fn(async () => undefined) }))

import { backfillPreLeagueWeeks } from '@/lib/redraft/preLeagueWeeks'

beforeEach(() => {
  st.survivorMode = false
  st.guillotine = false
  st.created = []
})

describe('backfillPreLeagueWeeks', () => {
  it('builds no head-to-head weeks for a Survivor league', async () => {
    st.survivorMode = true
    const r = await backfillPreLeagueWeeks({ seasonId: 'S', firstLeagueWeek: 6 })
    expect(st.created).toEqual([])
    expect(r.created).toEqual([])
  })

  it('builds none for a guillotine league either', async () => {
    st.guillotine = true
    await backfillPreLeagueWeeks({ seasonId: 'S', firstLeagueWeek: 6 })
    expect(st.created).toEqual([])
  })

  it('[control] a head-to-head league still gets its missed weeks', async () => {
    const r = await backfillPreLeagueWeeks({ seasonId: 'S', firstLeagueWeek: 6 })
    expect(st.created.length).toBeGreaterThan(0)
    expect(r.created).toEqual([1, 2, 3, 4, 5])
  })
})
