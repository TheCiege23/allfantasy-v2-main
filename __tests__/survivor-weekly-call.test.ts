// @vitest-environment node
/**
 * "Call the week": the weekly mini-game. Calls are hidden until they lock, settle from the same
 * finalized scores as the slate, and earn bragging rights only (no reward rides on them).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = { challenges: [] as any[], submissions: [] as any[] }
  return {
    state,
    db: {
      survivorLeagueConfig: { findUnique: vi.fn(async () => ({ id: 'cfg' })) },
      survivorChallenge: {
        findFirst: vi.fn(async ({ where }: any) => state.challenges.find(c => (!where.id || c.id === where.id) && (!where.week || c.week === where.week) && c.challengeType === where.challengeType) ?? null),
        findMany: vi.fn(async () => state.challenges.map(c => ({ ...c, submissions: state.submissions.filter(s => s.challengeId === c.id) }))),
        upsert: vi.fn(async ({ create }: any) => { const row = { id: `ch-${create.week}`, resultJson: null, ...create }; state.challenges.push(row); return row }),
        update: vi.fn(async ({ where, data }: any) => Object.assign(state.challenges.find(c => c.id === where.id), data)),
      },
      survivorChallengeSubmission: {
        upsert: vi.fn(async ({ where, create, update }: any) => {
          const key = where.uniq_challenge_user
          const row = state.submissions.find(s => s.challengeId === key.challengeId && s.userId === key.userId)
          if (row) return Object.assign(row, update)
          const made = { id: `s-${state.submissions.length}`, isCorrect: null, ...create }
          state.submissions.push(made)
          return made
        }),
        findMany: vi.fn(async ({ where }: any) => state.submissions.filter(s => s.challengeId === where.challengeId)),
        update: vi.fn(async ({ where, data }: any) => Object.assign(state.submissions.find(s => s.id === where.id), data)),
      },
      survivorPlayer: {
        findMany: vi.fn(async ({ where }: any) => [
          { userId: 'a', displayName: 'Ava', playerState: 'active' }, { userId: 'b', displayName: 'Ben', playerState: 'active' }, { userId: 'c', displayName: 'Cy', playerState: 'eliminated' },
        ].filter(p => !where.playerState || p.playerState === where.playerState)),
        findFirst: vi.fn(async ({ where }: any) => (['a', 'b', 'c'].includes(where.userId) ? { userId: where.userId } : null)),
      },
      survivorTribe: { findMany: vi.fn(async () => [{ id: 't1', name: 'Tala' }, { id: 't2', name: 'Moto' }]) },
      survivorWeeklyScore: { findMany: vi.fn(async () => [
        { userId: 'a', tribeId: 't2', finalScore: 150, isFinalized: true, countedTowardTribeTotal: true },
        { userId: 'b', tribeId: 't1', finalScore: 120, isFinalized: true, countedTowardTribeTotal: true },
      ]) },
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    },
  }
})
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))

import { ensureWeeklyCall, loadWeeklyCallBoard, settleWeeklyCall, submitWeeklyCall, weeklyCallLockAt } from '@/lib/survivor/survivorWeeklyCall'

const opened = new Date('2026-10-13T12:00:00Z') // NFL week 6 Tuesday
beforeEach(() => { h.state.challenges.length = 0; h.state.submissions.length = 0; vi.clearAllMocks() })

describe('weeklyCallLockAt', () => {
  it('locks NFL calls Thursday 18:00 Eastern, before Thursday Night Football; a late week gets six hours', () => {
    expect(weeklyCallLockAt('NFL', 2026, 6, opened)!.toISOString()).toBe('2026-10-15T22:00:00.000Z')
    expect(weeklyCallLockAt('NFL', 2026, 6, new Date('2026-10-16T12:00:00Z'))!.toISOString()).toBe('2026-10-16T18:00:00.000Z')
  })
})

describe('the weekly call', () => {
  it('opens once with the tribes before the merge, hides calls until the lock, then settles and names who called it', async () => {
    await ensureWeeklyCall('L1', 6, { sport: 'NFL', season: 2026, merged: false, now: opened })
    await ensureWeeklyCall('L1', 6, { sport: 'NFL', season: 2026, merged: false, now: opened })
    expect(h.db.survivorChallenge.upsert).toHaveBeenCalledTimes(1)
    const [call] = h.state.challenges
    expect(call.configJson).toEqual({ kind: 'top_tribe', options: [{ id: 't1', label: 'Tala' }, { id: 't2', label: 'Moto' }] })

    expect(await submitWeeklyCall('L1', 'a', call.id, 't2', opened)).toEqual({ ok: true, pick: { id: 't2', label: 'Moto' } })
    expect(await submitWeeklyCall('L1', 'b', call.id, 't1', opened)).toEqual(expect.objectContaining({ ok: true }))
    // A manager who is out of the game still plays.
    expect(await submitWeeklyCall('L1', 'c', call.id, 't2', opened)).toEqual(expect.objectContaining({ ok: true }))
    expect(await submitWeeklyCall('L1', 'a', call.id, 'nope', opened)).toEqual(expect.objectContaining({ ok: false, status: 400 }))
    expect(await submitWeeklyCall('L1', 'zed', call.id, 't1', opened)).toEqual(expect.objectContaining({ ok: false, status: 403 }))

    const before = await loadWeeklyCallBoard('L1', 'a', opened)
    expect(before.current!.status).toBe('open')
    expect(before.current!.myPick).toBe('t2')
    expect(before.current!.options.every(o => o.calls === null)).toBe(true)

    const afterLock = new Date('2026-10-16T00:00:00Z')
    expect(await submitWeeklyCall('L1', 'b', call.id, 't2', afterLock)).toEqual(expect.objectContaining({ ok: false, status: 409 }))
    expect((await loadWeeklyCallBoard('L1', 'b', afterLock)).current!.options).toEqual([{ id: 't1', label: 'Tala', calls: 1 }, { id: 't2', label: 'Moto', calls: 2 }])

    await settleWeeklyCall('L1', 6)
    expect(call.status).toBe('complete')
    expect(call.resultSummary).toBe('Moto scored the most. 2 of 3 called it.')
    // Bragging rights only: no reward fields, no roster or tribe winner a reward engine could pay.
    expect(call.rewardType).toBeUndefined()
    expect(call.winnerTribeId).toBeUndefined()
    const board = await loadWeeklyCallBoard('L1', 'a', afterLock)
    expect(board.current).toBeNull()
    expect(board.past[0]).toEqual(expect.objectContaining({ answer: { id: 't2', label: 'Moto' }, correct: ['Ava', 'Cy'] }))
    expect(board.leaderboard).toEqual([
      { userId: 'a', name: 'Ava', correct: 1, calls: 1 }, { userId: 'c', name: 'Cy', correct: 1, calls: 1 }, { userId: 'b', name: 'Ben', correct: 0, calls: 1 },
    ])
  })

  it('after the merge the call is who posts the top score', async () => {
    await ensureWeeklyCall('L1', 12, { sport: 'NFL', season: 2026, merged: true, now: new Date('2026-11-24T12:00:00Z') })
    const [call] = h.state.challenges
    expect(call.configJson.kind).toBe('top_scorer')
    expect(call.configJson.options.map((o: any) => o.label)).toEqual(['Ava', 'Ben'])
    await submitWeeklyCall('L1', 'b', call.id, 'a', new Date('2026-11-24T13:00:00Z'))
    await settleWeeklyCall('L1', 12)
    expect(call.resultSummary).toBe('Ava posted the top score. 1 of 1 called it.')
  })
})
