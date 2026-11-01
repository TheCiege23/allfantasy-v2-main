// @vitest-environment node
/**
 * The challenge builder's DB half, on an in-memory Prisma double: create (server validation), the
 * first answer stands, "no two entrants may give the same answer", settling from a stored
 * PlayerWeeklyScore (never a provider), one payout per key even when settled twice, the reversal
 * through reverseSurvivorReward with a fresh round, and the runner's open/lock/settle step with
 * deterministic host-line ids.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type AnyRec = Record<string, any>
const h = vi.hoisted(() => {
  const state = {
    challenges: [] as AnyRec[],
    submissions: [] as AnyRec[],
    audits: [] as AnyRec[],
    players: [] as AnyRec[],
    tribes: [] as AnyRec[],
    weekly: null as AnyRec | null,
    settings: {} as AnyRec,
    phase: 'pre_merge',
  }
  let n = 0
  const match = (row: AnyRec, where: AnyRec = {}) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      if ('in' in v) return (v.in as unknown[]).includes(row[k])
      if ('not' in v) return row[k] !== v.not
      if ('startsWith' in v) return String(row[k] ?? '').startsWith(v.startsWith)
      return true
    }
    return row[k] === v
  })
  const db = {
    league: { findUnique: vi.fn(async () => ({ language: 'en', settings: state.settings, sport: 'NFL', season: 2026, userId: 'commish' })) },
    survivorGameState: { findUnique: vi.fn(async () => ({ currentWeek: 9, phase: state.phase, mergeTriggeredAt: null })) },
    survivorLeagueConfig: { findUnique: vi.fn(async () => ({ id: 'cfg' })) },
    survivorChallenge: {
      findMany: vi.fn(async ({ where }: AnyRec) => state.challenges.filter((c) => match(c, where)).map((c) => ({ ...c, submissions: state.submissions.filter((s) => s.challengeId === c.id) }))),
      findFirst: vi.fn(async ({ where }: AnyRec) => state.challenges.find((c) => match(c, where)) ?? null),
      create: vi.fn(async ({ data }: AnyRec) => { const row = { id: `ch${++n}`, resultJson: null, resultSummary: null, ...data }; state.challenges.push(row); return row }),
      update: vi.fn(async ({ where, data }: AnyRec) => { const row = state.challenges.find((c) => c.id === where.id)!; Object.assign(row, data); return row }),
      updateMany: vi.fn(async ({ where, data }: AnyRec) => { const rows = state.challenges.filter((c) => match(c, where)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length } }),
    },
    survivorChallengeSubmission: {
      findMany: vi.fn(async ({ where }: AnyRec) => state.submissions.filter((s) => match(s, where))),
      count: vi.fn(async ({ where }: AnyRec) => state.submissions.filter((s) => match(s, where)).length),
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: AnyRec) => {
        const dup = state.submissions.find((s) => s.challengeId === data.challengeId && ((data.rosterId && s.rosterId === data.rosterId) || (data.tribeId && s.tribeId === data.tribeId) || s.userId === data.userId))
        if (dup) throw new Error('unique violation')
        const row = { submittedAt: new Date(`2026-11-01T16:0${state.submissions.length}:00Z`), ...data }
        state.submissions.push(row)
        return row
      }),
    },
    survivorPlayer: {
      findFirst: vi.fn(async ({ where }: AnyRec) => state.players.find((p) => match(p, where)) ?? null),
      findMany: vi.fn(async ({ where }: AnyRec) => state.players.filter((p) => match(p, where))),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    survivorTribe: { findMany: vi.fn(async () => state.tribes) },
    survivorAuditEntry: { create: vi.fn(async ({ data }: AnyRec) => { state.audits.push(data); return data }), findMany: vi.fn(async () => []) },
    playerWeeklyScore: { findFirst: vi.fn(async () => state.weekly), findMany: vi.fn(async () => []) },
    sportsGame: { findMany: vi.fn(async () => []) },
    redraftRosterPlayer: { findMany: vi.fn(async () => []) },
  }
  return { state, db, apply: vi.fn(), reverse: vi.fn(), post: vi.fn(async () => true), sealed: vi.fn(async () => false) }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/survivor/survivorRewardEngine', () => ({ applySurvivorReward: h.apply, reverseSurvivorReward: h.reverse, readSurvivorFaabBalance: vi.fn(async () => 100) }))
vi.mock('@/lib/survivor/leagueChatPoster', () => ({ postChallengeBuilderLine: h.post }))
vi.mock('@/lib/survivor/survivorSealedImmunityState', () => ({ loadImmunitySealed: h.sealed }))
vi.mock('@/lib/follows/teamFollows', () => ({ getTeamIndex: vi.fn(async () => null) }))
vi.mock('@/lib/inactive-manager/chimmyPlayable', () => ({ readPlayableChimmyLineups: vi.fn(async () => ({})) }))
vi.mock('@/lib/inactive-manager/inactiveManagerMode', () => ({ isChimmyRunning: () => false }))

import {
  createBuilderChallenge, reverseBuilderChallenge, runChallengeBuilderStep, settleBuilderChallenge, submitBuilderAnswer,
} from '@/lib/survivor/survivorChallengeBuilder'

const NOW = new Date('2026-11-01T15:00:00Z')
const AFTER_LOCK = new Date('2026-11-02T03:00:00Z')
const player = { playerId: 'p1', playerName: 'Josh Allen', sport: 'NFL', season: 2026, statWeek: 9 }
const tdChallenge = {
  title: 'Anytime TD', question: 'Does Josh Allen score?', kind: 'anytime_td', scope: 'individual',
  opensAt: '2026-11-01T09:00', locksAt: '2026-11-01T20:00', player, uniqueAnswers: false,
  prizes: [{ place: 1, rewards: [{ type: 'score_bonus', points: 20 }] }],
  missPenalty: { type: 'score_penalty', points: 5 },
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(h.state, { challenges: [], submissions: [], audits: [], weekly: null, settings: {}, phase: 'pre_merge' })
  h.state.players = [
    { leagueId: 'L', userId: 'u1', tribeId: 't1', redraftRosterId: 'r1', displayName: 'Ana', playerState: 'active' },
    { leagueId: 'L', userId: 'u2', tribeId: 't1', redraftRosterId: 'r2', displayName: 'Ben', playerState: 'active' },
    { leagueId: 'L', userId: 'u3', tribeId: 't2', redraftRosterId: 'r3', displayName: 'Cy', playerState: 'active' },
  ]
  h.state.tribes = [{ id: 't1', name: 'Koa' }, { id: 't2', name: 'Vela' }]
  let k = 0
  h.apply.mockImplementation(async (input: AnyRec) => ({ ok: true, rewardId: input.idempotencyKey, status: 'applied', duplicate: false, changes: [], note: null, n: ++k }))
  h.reverse.mockResolvedValue({ ok: true, rewardId: 'x', status: 'reversed', duplicate: false, changes: [], note: null })
})

describe('createBuilderChallenge', () => {
  it('validates on the server and opens with a host line', async () => {
    expect(await createBuilderChallenge('L', 'commish', { ...tdChallenge, title: '' }, NOW)).toMatchObject({ ok: false, status: 400, code: 'title' })
    const made = await createBuilderChallenge('L', 'commish', tdChallenge, NOW)
    expect(made.ok).toBe(true)
    const row = h.state.challenges[0]!
    expect(row).toMatchObject({ challengeType: 'commissioner_challenge', challengeNumber: 10, status: 'open', scope: 'individual' })
    expect(h.post).toHaveBeenCalledWith('L', expect.stringMatching(/New challenge: Anytime TD/), `survivor-cb:${row.id}:open`, expect.anything())
  })

  it('refuses FAAB over the weekly cap, counting the week’s other challenges', async () => {
    h.state.challenges.push({ id: 'old', leagueId: 'L', week: 9, rewardType: 'faab', rewardAmount: 30, status: 'open', challengeType: 'commissioner_challenge', challengeNumber: 10 })
    const r = await createBuilderChallenge('L', 'commish', { ...tdChallenge, prizes: [{ place: 1, rewards: [{ type: 'faab_grant', amount: 20 }] }] }, NOW)
    expect(r).toMatchObject({ ok: false, code: 'faabCap' })
    h.state.settings = { survivorChallengeFaabWeeklyCap: 60 }
    expect((await createBuilderChallenge('L', 'commish', { ...tdChallenge, prizes: [{ place: 1, rewards: [{ type: 'faab_grant', amount: 20 }] }] }, NOW)).ok).toBe(true)
  })
})

describe('answers', () => {
  it('the first answer stands, and only castaways still in the game answer', async () => {
    await createBuilderChallenge('L', 'commish', tdChallenge, NOW)
    const id = h.state.challenges[0]!.id
    expect(await submitBuilderAnswer('L', 'u1', id, { optionId: 'yes' }, NOW)).toMatchObject({ ok: true })
    expect(await submitBuilderAnswer('L', 'u1', id, { optionId: 'no' }, NOW)).toMatchObject({ ok: false, status: 409 })
    expect(await submitBuilderAnswer('L', 'ghost', id, { optionId: 'no' }, NOW)).toMatchObject({ ok: false, status: 403 })
    expect(await submitBuilderAnswer('L', 'u2', id, { optionId: 'maybe' }, NOW)).toMatchObject({ ok: false, status: 400 })
    expect(await submitBuilderAnswer('L', 'u2', id, { optionId: 'no' }, AFTER_LOCK)).toMatchObject({ ok: false, status: 409 })
  })

  it('tribe scope: one answer per tribe; uniqueness makes the next tribe re-pick', async () => {
    await createBuilderChallenge('L', 'commish', { ...tdChallenge, kind: 'custom_number', scope: 'tribe', player: undefined, missPenalty: undefined, uniqueAnswers: true }, NOW)
    const id = h.state.challenges[0]!.id
    expect(await submitBuilderAnswer('L', 'u1', id, { value: 44 }, NOW)).toMatchObject({ ok: true })
    expect(await submitBuilderAnswer('L', 'u2', id, { value: 47 }, NOW)).toMatchObject({ ok: false, status: 409 })
    expect(await submitBuilderAnswer('L', 'u3', id, { value: 44 }, NOW)).toMatchObject({ ok: false, code: 'answer_taken' })
    expect(await submitBuilderAnswer('L', 'u3', id, { value: 45 }, NOW)).toMatchObject({ ok: true })
    expect(h.state.submissions.map((s) => s.tribeId)).toEqual(['t1', 't2'])
  })
})

describe('settlement', () => {
  async function lockedTd() {
    await createBuilderChallenge('L', 'commish', tdChallenge, NOW)
    const id = h.state.challenges[0]!.id
    await submitBuilderAnswer('L', 'u1', id, { optionId: 'yes' }, NOW)
    await submitBuilderAnswer('L', 'u3', id, { optionId: 'no' }, NOW)
    return id
  }

  it('waits for a finalized stored stat, then pays winners and charges misses — once', async () => {
    const id = await lockedTd()
    expect(await settleBuilderChallenge('L', id, { now: AFTER_LOCK })).toMatchObject({ ok: true, outcome: 'pending', pending: 'no_stats_stored' })
    h.state.weekly = { stats: { rush_td: 1, rec_td: 0 }, fantasyPts: 24, isFinalized: true }
    expect(await settleBuilderChallenge('L', id, { now: AFTER_LOCK })).toMatchObject({ ok: true, outcome: 'settled' })
    expect(h.apply.mock.calls.map((c) => [c[0].idempotencyKey, c[0].reward])).toEqual([
      [`cb:${id}:r0:p1:0:r1`, { type: 'score_bonus', rosterId: 'r1', points: 20 }],
      [`cb:${id}:r0:m:r3`, { type: 'score_penalty', rosterId: 'r3', points: 5 }],
    ])
    const row = h.state.challenges[0]!
    expect(row.status).toBe('complete')
    expect(row.resultSummary).toMatch(/Winners: Ana/)
    // A second settle (another runner tick) is refused: the row is no longer locked.
    expect((await settleBuilderChallenge('L', id, { now: AFTER_LOCK })).ok).toBe(false)
    expect(h.apply).toHaveBeenCalledTimes(2)
    expect(h.post).toHaveBeenCalledWith('L', expect.any(String), `survivor-cb:${id}:result:0`, expect.anything())
  })

  it('a manual settle uses the commissioner’s answer; a reverse undoes every reward and bumps the round', async () => {
    const id = await lockedTd()
    expect(await settleBuilderChallenge('L', id, { now: AFTER_LOCK, manual: { truth: { optionId: 'no' } }, actorUserId: 'commish' })).toMatchObject({ outcome: 'settled' })
    expect(h.apply.mock.calls.map((c) => c[0].reward.rosterId)).toEqual(['r3', 'r1'])
    const rev = await reverseBuilderChallenge('L', id, 'commish', 'wrong answer')
    expect(rev).toMatchObject({ ok: true, reversed: 2 })
    expect(h.reverse).toHaveBeenCalledTimes(2)
    expect(h.state.challenges[0]).toMatchObject({ status: 'locked', resultJson: { round: 1 } })
    h.apply.mockClear()
    await settleBuilderChallenge('L', id, { now: AFTER_LOCK, manual: { truth: { optionId: 'yes' } }, actorUserId: 'commish' })
    expect(h.apply.mock.calls[0]![0].idempotencyKey).toBe(`cb:${id}:r1:p1:0:r1`)
  })

  it('void pays nothing', async () => {
    const id = await lockedTd()
    expect(await settleBuilderChallenge('L', id, { now: AFTER_LOCK, manual: { void: true } })).toMatchObject({ outcome: 'void' })
    expect(h.apply).not.toHaveBeenCalled()
  })
})

describe('runChallengeBuilderStep', () => {
  it('opens on the clock, locks with a host line, and settles from stored data', async () => {
    await createBuilderChallenge('L', 'commish', { ...tdChallenge, opensAt: '2026-11-01T12:00' }, NOW)
    const id = h.state.challenges[0]!.id
    expect(h.state.challenges[0]!.status).toBe('scheduled')
    expect(await runChallengeBuilderStep('L', new Date('2026-11-01T17:30:00Z'))).toMatchObject({ opened: 1 })
    expect(h.post).toHaveBeenCalledWith('L', expect.any(String), `survivor-cb:${id}:open`, expect.anything())
    await submitBuilderAnswer('L', 'u1', id, { optionId: 'yes' }, new Date('2026-11-01T18:00:00Z'))
    h.state.weekly = { stats: { rec_td: 2 }, fantasyPts: 30, isFinalized: true }
    const out = await runChallengeBuilderStep('L', AFTER_LOCK)
    expect(out).toMatchObject({ locked: 1, settled: 1 })
    expect(h.post).toHaveBeenCalledWith('L', expect.stringMatching(/locked \(1 in\)/), `survivor-cb:${id}:lock`, expect.anything())
    expect(h.state.audits.map((a) => a.action)).toEqual(expect.arrayContaining(['challenge_builder_created', 'challenge_builder_opened', 'challenge_builder_locked', 'challenge_builder_settled']))
  })
})
