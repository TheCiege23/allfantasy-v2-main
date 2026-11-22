/**
 * @vitest-environment node
 *
 * The home extras carry the survival history (lib/league-specialty/guillotineHome.ts): this season's
 * weeks only, every team named, close calls by the league's own danger margin.
 */
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ periodWheres: [] as unknown[] }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ season: 2026 })) },
    roster: { findMany: vi.fn(async () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }]) },
    guillotineRosterState: { findMany: vi.fn(async () => [{ rosterId: 'b', choppedInPeriod: 1, choppedAt: new Date('2026-10-20') }]) },
    guillotinePeriodScore: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        h.periodWheres.push(where)
        return [
          { rosterId: 'a', weekOrPeriod: 1, periodPoints: 100 },
          { rosterId: 'b', weekOrPeriod: 1, periodPoints: 60 },
          { rosterId: 'c', weekOrPeriod: 1, periodPoints: 64 },
        ]
      }),
    },
    guillotineWaiverRelease: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/guillotine/GuillotineDangerEngine', () => ({ getDangerTiers: vi.fn(async () => []) }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ getGuillotineConfig: vi.fn(async () => ({ dangerMarginPoints: 3 })) }))
vi.mock('@/lib/guillotine/rosterDisplayNames', () => ({
  resolveRosterDisplayNames: vi.fn(async (_l: string, ids: string[]) => new Map(ids.map((id) => [id, `Team ${id.toUpperCase()}`]))),
}))

import { buildGuillotineHomeExtras } from '@/lib/league-specialty/guillotineHome'

describe('home extras — survival history', () => {
  it('this season only, every team named, close calls by the league’s danger margin', async () => {
    const home = await buildGuillotineHomeExtras('L1', 'NBA', 2)
    expect(h.periodWheres).toContainEqual({ leagueId: 'L1', season: 2026 })
    expect(home.history.weeks[0]).toMatchObject({ week: 1, chopLine: 60, closestEscape: { rosterId: 'c', name: 'Team C', margin: 4 } })
    const c = home.history.teams.find((t) => t.rosterId === 'c')!
    // 4 points above the line is NOT a close call when the league's margin is 3.
    expect(c).toMatchObject({ name: 'Team C', closeCalls: 0, bestEscape: 4 })
  })
})
