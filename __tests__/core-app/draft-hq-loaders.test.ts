import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({
  draftSession: { findMany: vi.fn(), findFirst: vi.fn() }, leagueTeam: { findMany: vi.fn() },
  draftPick: { groupBy: vi.fn(), findMany: vi.fn() }, draftQueueEntry: { groupBy: vi.fn() }, draftQueue: { findMany: vi.fn() },
}))
vi.mock('@/lib/core-app/draftAfProjections', () => ({ loadDraftAfProjections: async () => ({ byPlayerId: new Map() }) }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/core-app/leagueHome', () => ({ leagueDisplayName: (name: string) => name }))
vi.mock('@/lib/core-app/leagueContext', () => ({ leagueContextFor: (_league: string, _user: string, context: unknown) => context }))
import { getDraftHqAll, phaseOf } from '@/lib/core-app/draftHqAll'
import { getDraftBoardData } from '@/lib/core-app/draftBoard'
const order = [{ slot: 1, rosterId: 'a', displayName: 'Alpha' }, { slot: 2, rosterId: 'b', displayName: 'Beta' }]
function session(overrides = {}) {
  return { id: 'new', leagueId: 'one', createdAt: new Date('2026-09-01'), status: 'in_progress', draftType: 'snake',
    rounds: 3, teamCount: 2, slotOrder: order, nextOverallPick: 5, currentRoundNum: 3,
    thirdRoundReversal: true, tradedPicks: [], timerEndAt: new Date('2026-10-03'),
    pausedRemainingSeconds: null, startedAt: null, draftModeLabel: null, ...overrides }
}
beforeEach(() => {
  vi.resetAllMocks()
  db.draftSession.findMany.mockResolvedValue([session()])
  db.draftSession.findFirst.mockResolvedValue(session())
  db.leagueTeam.findMany.mockResolvedValue([{ leagueId: 'one', externalId: 'b' }])
  db.draftPick.groupBy.mockResolvedValue([])
  db.draftPick.findMany.mockResolvedValue([])
  db.draftQueueEntry.groupBy.mockResolvedValue([])
  db.draftQueue.findMany.mockResolvedValue([])
})
describe('Draft HQ loader regressions', () => {
  it('deduplicates league cards and counts leagues independently from historical sessions', async () => {
    db.draftSession.findMany.mockResolvedValue([session(), session({ id: 'old', createdAt: new Date('2025-09-01'), status: 'completed' })])
    const result = await getDraftHqAll('user', [{ id: 'one' }, { id: 'two' }])
    expect(result.rows).toHaveLength(1)
    expect(result.withoutDraft).toBe(1)
    expect(result.counts).toMatchObject({ live: 1, done: 0 })
    expect(result.rows[0].yoursOnClock).toBe(true)
  })
  it('resolves traded OTC ownership identically on the universal and league views', async () => {
    const active = session({ nextOverallPick: 1, tradedPicks: [{ round: 1, originalRosterId: 'a', newRosterId: 'b', newOwnerName: 'Beta' }] })
    db.draftSession.findMany.mockResolvedValue([active])
    db.draftSession.findFirst.mockResolvedValue(active)
    const all = await getDraftHqAll('user', [{ id: 'one' }])
    const context = { league: async () => ({ id: 'one', name: 'One', platform: 'manual' }), claimedTeam: async () => ({ externalId: 'b' }) }
    const league = await getDraftBoardData('one', 'user', context as never)
    expect(all.rows[0].onClockName).toBe('Beta')
    expect(all.rows[0].yoursOnClock).toBe(true)
    expect(league?.clock.available && league.clock.data.yoursOnClock).toBe(true)
  })
  it('uses the stored cursor despite missing selections, and returns all planned rounds', async () => {
    db.draftPick.findMany.mockResolvedValue([{ overall: 1, round: 1, slot: 1, rosterId: 'a', displayName: 'Alpha', playerName: 'Player', position: 'WR' }])
    const context = { league: async () => ({ id: 'one', name: 'One', platform: 'manual' }), claimedTeam: async () => ({ externalId: 'b' }) }
    const result = await getDraftBoardData('one', 'user', context as never)
    expect(result?.session.available && result.session.data.currentPickOverall).toBe(5)
    expect(result?.board.available && result.board.data.rounds).toBe(3)
    expect(result?.clock.available && result.clock.data.yoursOnClock).toBe(true)
  })
  it('does not run a countdown while paused', async () => {
    db.draftSession.findMany.mockResolvedValue([session({ status: 'paused' })])
    const result = await getDraftHqAll('user', [{ id: 'one' }])
    expect(result.rows[0].pickExpiresAt).toBeNull()
  })
  it('does not run a league countdown when paused remaining time is missing', async () => {
    db.draftSession.findFirst.mockResolvedValue(session({ status: 'paused', pausedRemainingSeconds: null }))
    const context = { league: async () => ({ id: 'one', name: 'One', platform: 'manual' }), claimedTeam: async () => ({ externalId: 'b' }) }
    const result = await getDraftBoardData('one', 'user', context as never)
    expect(result?.clock.available && result.clock.data.endsAt).toBeNull()
  })
  it('keeps expired status unknown and recognizes configured drafts', () => {
    expect(phaseOf('expired')).toBe('unknown')
    expect(phaseOf('configured')).toBe('upcoming')
  })
})
