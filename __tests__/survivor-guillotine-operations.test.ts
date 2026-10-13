import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSGConfig } from '@/lib/survivor-guillotine/config'

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => ({ findUniqueOrThrow: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() }))
const teamDb = vi.hoisted(() => ({ findFirst: vi.fn() }))
const rosterDb = vi.hoisted(() => ({ findMany: vi.fn(), findUniqueOrThrow: vi.fn() }))
const tribeDb = vi.hoisted(() => ({ findMany: vi.fn(), upsert: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { survivorGuillotineLeague: db,
  leagueTeam: teamDb, roster: rosterDb, survivorGuillotineTribeChoice: tribeDb,
  $transaction: (fn: (tx: unknown) => unknown) => fn({ survivorGuillotineLeague: db,
    survivorGuillotineTribeChoice: tribeDb }) } }))

import { chooseSGStartingTribe, pickSGCaptainDraft, runSGSelectionDeadlines,
  saveSGCalendar, startSGCaptainDraft } from '@/lib/survivor-guillotine/operations'

const row = (start: string, end: string, ceremony: string) => ({ scoringStartsAt: start,
  scoringEndsAt: end, ceremonyAt: ceremony, selectionDeadlineAt: start })

describe('Survivor Guillotine calendar and concealed rewards', () => {
  beforeEach(() => {
    db.findUniqueOrThrow.mockReset().mockResolvedValue({ config: defaultSGConfig(), currentPeriod: 0,
      periodCalendar: {}, rewardPeriods: [], revision: 1 })
    db.findMany.mockReset().mockResolvedValue([])
    db.updateMany.mockReset().mockResolvedValue({ count: 1 })
    db.update.mockReset()
    teamDb.findFirst.mockReset()
    rosterDb.findMany.mockReset()
    rosterDb.findUniqueOrThrow.mockReset()
    tribeDb.findMany.mockReset()
    tribeDb.upsert.mockReset()
  })

  it('rejects overlapping scoring periods before saving a season', async () => {
    await expect(saveSGCalendar('league', {
      1: row('2026-09-01T00:00:00Z', '2026-09-08T00:00:00Z', '2026-09-09T00:00:00Z'),
      2: row('2026-09-07T00:00:00Z', '2026-09-14T00:00:00Z', '2026-09-15T00:00:00Z'),
    }, [])).rejects.toThrow('cannot overlap')
    expect(db.updateMany).not.toHaveBeenCalled()
  })

  it('adds a reward period without dropping a concealed choice on calendar edits', async () => {
    db.findUniqueOrThrow.mockResolvedValue({ config: defaultSGConfig(), currentPeriod: 1,
      periodCalendar: { 1: row('2026-09-01T00:00:00Z', '2026-09-08T00:00:00Z', '2026-09-09T00:00:00Z') },
      rewardPeriods: [2], revision: 4 })
    const result = await saveSGCalendar('league', {
      1: row('2026-09-01T00:00:00Z', '2026-09-08T00:00:00Z', '2026-09-09T00:00:00Z'),
    }, [4])
    expect(result.rewardsAdded).toBe(1)
    expect(db.updateMany.mock.calls[0][0].data.rewardPeriods).toEqual([2, 4])
  })

  it('keeps a completed period calendar immutable', async () => {
    db.findUniqueOrThrow.mockResolvedValue({ config: defaultSGConfig(), currentPeriod: 2,
      periodCalendar: { 1: row('2026-09-01T00:00:00Z', '2026-09-08T00:00:00Z', '2026-09-09T00:00:00Z') },
      rewardPeriods: [], revision: 4 })
    await expect(saveSGCalendar('league', { 1: row('2026-09-02T00:00:00Z',
      '2026-09-08T00:00:00Z', '2026-09-09T00:00:00Z') }, [])).rejects.toThrow('cannot be rescheduled')
  })

  it('fills missing Match Play choices with distinct cross-tribe pairs at the random cutoff', async () => {
    const config = { ...defaultSGConfig(), missingSubmission: 'random' as const }
    db.findMany.mockResolvedValue([{ leagueId: 'league', currentPeriod: 1, config, revision: 2,
      tribes: [
        { rosterId: 'a', tribeId: 'red' }, { rosterId: 'b', tribeId: 'red' },
        { rosterId: 'c', tribeId: 'blue' }, { rosterId: 'd', tribeId: 'blue' },
      ], periodState: { period: 1, matchups: [], champions: [], sitOuts: [], priorSitOuts: [],
        ceremonyAt: '2026-09-10T00:00:00Z', selectionDeadlineAt: '2026-09-09T00:00:00Z',
        ceremonyStarted: false } }])
    const result = await runSGSelectionDeadlines(new Date('2026-09-09T01:00:00Z'))
    expect(result.results).toEqual([{ leagueId: 'league', status: 'resolved' }])
    const pairs = db.updateMany.mock.calls[0][0].data.periodState.matchups as { team1: string; team2: string }[]
    expect(pairs).toHaveLength(2)
    expect(new Set(pairs.flatMap(p => [p.team1, p.team2])).size).toBe(4)
    expect(pairs.every(p => ['a', 'b'].includes(p.team1) !== ['a', 'b'].includes(p.team2))).toBe(true)
  })

  it('rejects a manager choice that would overfill a starting tribe', async () => {
    db.findUniqueOrThrow.mockResolvedValue({ config: { ...defaultSGConfig(), teamCount: 4,
      tribeCount: 2, tribeFormation: 'manager_choice' }, currentPeriod: 0, tribes: [], revision: 1 })
    teamDb.findFirst.mockResolvedValue({ legacyRosterId: 'd' })
    rosterDb.findUniqueOrThrow.mockResolvedValue({ id: 'd', playerData: {}, faabRemaining: 100 })
    rosterDb.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])
    tribeDb.findMany.mockResolvedValue([{ rosterId: 'a', tribeId: 'tribe-0' },
      { rosterId: 'b', tribeId: 'tribe-0' }, { rosterId: 'c', tribeId: 'tribe-1' }])
    await expect(chooseSGStartingTribe('league', 'manager', 'tribe-0')).rejects.toThrow('full')
    expect(tribeDb.upsert).not.toHaveBeenCalled()
    const result = await chooseSGStartingTribe('league', 'manager', 'tribe-1')
    expect(result.readyForCaptainVote).toBe(true)
    expect(db.update).toHaveBeenCalled()
  })

  it('runs a captain-led snake draft and leaves captain voting to the completed tribes', async () => {
    const config = { ...defaultSGConfig(), teamCount: 4, tribeCount: 2,
      tribeFormation: 'captain_draft' as const }
    rosterDb.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])
    db.findUniqueOrThrow.mockResolvedValueOnce({ config, currentPeriod: 0, tribes: [],
      tribeDraftState: {}, revision: 1 })
    const started = await startSGCaptainDraft('league', ['a', 'b'])
    expect(started.nextTribeId).toBe('tribe-0')
    db.findUniqueOrThrow.mockResolvedValueOnce({ config, currentPeriod: 0, revision: 2,
      tribes: [{ rosterId: 'a', tribeId: 'tribe-0', captain: false },
        { rosterId: 'b', tribeId: 'tribe-1', captain: false }],
      tribeDraftState: { status: 'active', leaders: started.leaders, pickIndex: 0, deadlineAt: null } })
    const first = await pickSGCaptainDraft('league', 'commissioner', 'c', true)
    expect(first).toMatchObject({ tribeId: 'tribe-0', complete: false, nextTribeId: 'tribe-1' })
    expect(db.updateMany.mock.calls[1][0].data.tribes).toEqual([
      { rosterId: 'a', tribeId: 'tribe-0', captain: false },
      { rosterId: 'b', tribeId: 'tribe-1', captain: false },
      { rosterId: 'c', tribeId: 'tribe-0', captain: false },
    ])
  })
})
