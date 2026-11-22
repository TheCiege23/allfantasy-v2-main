/** @vitest-environment node */
import { expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ evaluate: vi.fn(async () => ({ isLegal: true })) }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findFirst: vi.fn(async () => ({ id: 'league', sport: 'NBA', season: 2026,
  settings: { currentWeek: 1 }, lifecycleState: 'in_season' })) } } }))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: async () => ({ slots: [] }) }))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({ loadLeagueWeekContext: async () => ({ season: 2026, week: 8, maxWeek: 24 }) }))
vi.mock('@/lib/roster-legality/evaluateFullRosterLegality', () => ({ evaluateFullRosterLegalityAsync: h.evaluate }))
import { evaluateLegalityForPersistedRoster, evaluateLegalityForProjectedRoster } from '@/lib/roster-legality/loadLegalityEvaluationContext'
it.each(['saved', 'projected'])('evaluates a %s lineup in the canonical current period despite stale league JSON', async mode => {
  h.evaluate.mockClear()
  const roster = { id: 'roster', leagueId: 'league', playerData: {} }
  const result = mode === 'saved' ? await evaluateLegalityForPersistedRoster(roster) : await evaluateLegalityForProjectedRoster(roster, {})
  expect(result?.week).toBe(8)
  expect(h.evaluate).toHaveBeenCalledWith(expect.objectContaining({ ctx: expect.objectContaining({ week: 8 }),
    lockArgs: expect.objectContaining({ leagueWeek: 8, editingWeek: 8 }) }))
})
