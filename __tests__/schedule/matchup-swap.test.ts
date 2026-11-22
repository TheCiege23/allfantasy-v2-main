// @vitest-environment node
/**
 * The commissioner schedule editor: two teams trade places in one week (lib/schedule-runtime/matchupSwap.ts,
 * matchupSwapService.ts, 2026-11-15). Only a regular-season week that has not started; logged for the league.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  season: vi.fn(),
  rows: vi.fn(),
  update: vi.fn(async (a: unknown) => a),
  log: vi.fn(async () => ({ id: 'a' })),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findUnique: h.season },
    redraftMatchup: { findMany: h.rows, update: h.update },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  },
}))
vi.mock('@/server/services/auditService', () => ({ logAction: h.log }))

import { planTeamSwap } from '@/lib/schedule-runtime/matchupSwap'
import { swapTeamsInWeek } from '@/lib/schedule-runtime/matchupSwapService'
import { describeLogEntry, rosterIdsNamedBy } from '@/lib/league-log/leagueLog'

const week = [
  { id: 'm1', homeRosterId: 'A', awayRosterId: 'B' },
  { id: 'm2', homeRosterId: 'C', awayRosterId: 'D' },
  { id: 'm3', homeRosterId: 'E', awayRosterId: null }, // odd league: E has the bye
]

describe('planning a swap', () => {
  it('two teams trade places; everyone else keeps their game', () => {
    expect(planTeamSwap(week, 'B', 'C')).toEqual({
      ok: true,
      updates: [
        { id: 'm1', homeRosterId: 'A', awayRosterId: 'C' },
        { id: 'm2', homeRosterId: 'B', awayRosterId: 'D' },
      ],
    })
  })
  it('the bye moves with the team that had it', () => {
    expect(planTeamSwap(week, 'E', 'A')).toEqual({
      ok: true,
      updates: [
        { id: 'm3', homeRosterId: 'A', awayRosterId: null },
        { id: 'm1', homeRosterId: 'E', awayRosterId: 'B' },
      ],
    })
  })
  it('refuses the same team, opponents already, and a team not on the week', () => {
    expect(planTeamSwap(week, 'A', 'A')).toMatchObject({ ok: false, code: 'SAME_TEAM' })
    expect(planTeamSwap(week, 'A', 'B')).toMatchObject({ ok: false, code: 'ALREADY_OPPONENTS' })
    expect(planTeamSwap(week, 'A', 'Z')).toMatchObject({ ok: false, code: 'TEAM_NOT_IN_WEEK' })
  })
})

describe('applying a swap', () => {
  const season = (over: Record<string, unknown> = {}) => ({
    id: 's1', leagueId: 'L1', sport: 'NFL', season: 2026, currentWeek: 4, playoffStartWeek: 15,
    schedule: [{ week: 4, status: 'in_progress', homeScore: 10, awayScore: 3 }], ...over,
  })
  beforeEach(() => {
    vi.clearAllMocks()
    h.season.mockResolvedValue(season())
    h.rows.mockResolvedValue(week)
  })

  it('swaps a future week and records who did it', async () => {
    expect(await swapTeamsInWeek({ seasonId: 's1', week: 6, rosterA: 'B', rosterB: 'C', actorUserId: 'commish' })).toEqual({ ok: true, week: 6 })
    expect(h.update).toHaveBeenCalledTimes(2)
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L1', userId: 'commish', actionType: 'schedule_matchup_swap', metadata: { week: 6, rosterA: 'B', rosterB: 'C' } }))
  })

  it('a week that has started, or a playoff week, cannot change', async () => {
    expect(await swapTeamsInWeek({ seasonId: 's1', week: 4, rosterA: 'B', rosterB: 'C', actorUserId: 'commish' })).toMatchObject({ ok: false, code: 'WEEK_STARTED' })
    expect(await swapTeamsInWeek({ seasonId: 's1', week: 3, rosterA: 'B', rosterB: 'C', actorUserId: 'commish' })).toMatchObject({ ok: false, code: 'WEEK_STARTED' })
    expect(await swapTeamsInWeek({ seasonId: 's1', week: 15, rosterA: 'B', rosterB: 'C', actorUserId: 'commish' })).toMatchObject({ ok: false, code: 'NOT_REGULAR_SEASON' })
    expect(h.update).not.toHaveBeenCalled()
  })

  it('the league reads it with team names', () => {
    const row = { id: 'r', actionType: 'schedule_matchup_swap', entityId: 's1', userId: 'commish', beforeState: null, afterState: null, metadata: { week: 6, rosterA: 'B', rosterB: 'C' }, createdAt: new Date() }
    expect(rosterIdsNamedBy([row])).toEqual(expect.arrayContaining(['B', 'C']))
    const entry = describeLogEntry(row, { lang: 'en', names: { users: {}, teams: { B: 'Bears', C: 'Colts' } }, forCommissioner: false })
    expect(JSON.stringify(entry)).toContain('Swapped Bears and Colts in the week 6 schedule')
  })
})
