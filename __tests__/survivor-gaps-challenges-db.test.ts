// @vitest-environment node
/**
 * Survivor gaps (G2), the challenge builder's DB half for the new kinds, on an in-memory Prisma
 * double (never a provider): a puzzle settles itself at the lock by exact match (first correct
 * wins); position leaders settle from stored PlayerWeeklyScore rows; an NBA "anytime" prop is kept
 * but waits for the commissioner while an NHL one settles from the stored goals; a sweep is settled
 * by hand with tiered places; the league's per-phase prize rules refuse a prize on the server.
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
    weeklyRows: [] as AnyRec[],
    settings: {} as AnyRec,
    phase: 'pre_merge',
    merged: null as Date | null,
  }
  let n = 0
  const match = (row: AnyRec, where: AnyRec = {}) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      if ('in' in v) return (v.in as unknown[]).includes(row[k])
      if ('not' in v) return row[k] !== v.not
      if ('lt' in v) return row[k] < v.lt
      return true
    }
    return row[k] === v
  })
  const db = {
    league: { findUnique: vi.fn(async () => ({ language: 'en', settings: state.settings, sport: 'NFL', season: 2026, userId: 'commish' })) },
    survivorGameState: { findUnique: vi.fn(async () => ({ currentWeek: 9, phase: state.phase, mergeTriggeredAt: state.merged })) },
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
    playerWeeklyScore: {
      findFirst: vi.fn(async () => state.weekly),
      findMany: vi.fn(async ({ where }: AnyRec) => state.weeklyRows.filter((r) => match(r, { playerId: where.playerId, week: where.week, season: where.season }))),
    },
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
  createBuilderChallenge, loadBuilderBoard, playerStatValue, runChallengeBuilderStep, settleBuilderChallenge, submitBuilderAnswer,
} from '@/lib/survivor/survivorChallengeBuilder'

const NOW = new Date('2026-11-01T15:00:00Z')
const AFTER_LOCK = new Date('2026-11-02T03:00:00Z')
const base = { scope: 'individual', opensAt: '2026-11-01T09:00', locksAt: '2026-11-01T20:00', prizes: [{ place: 1, rewards: [{ type: 'score_bonus', points: 20 }] }] }

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(h.state, { challenges: [], submissions: [], audits: [], weekly: null, weeklyRows: [], settings: {}, phase: 'pre_merge', merged: null })
  h.state.players = [
    { leagueId: 'L', userId: 'u1', tribeId: 't1', redraftRosterId: 'r1', displayName: 'Ana', playerState: 'active' },
    { leagueId: 'L', userId: 'u2', tribeId: 't1', redraftRosterId: 'r2', displayName: 'Ben', playerState: 'active' },
    { leagueId: 'L', userId: 'u3', tribeId: 't2', redraftRosterId: 'r3', displayName: 'Cy', playerState: 'active' },
  ]
  h.state.tribes = [{ id: 't1', name: 'Koa' }, { id: 't2', name: 'Vela' }]
  h.apply.mockImplementation(async (input: AnyRec) => ({ ok: true, rewardId: input.idempotencyKey, status: 'applied', duplicate: false, changes: [], note: null }))
})

describe('puzzle', () => {
  it('keeps the answer off the manager board, then settles itself at the lock: the first correct answer wins', async () => {
    const made = await createBuilderChallenge('L', 'commish', { ...base, title: 'Riddle', question: 'Who has 7 rings?', kind: 'puzzle', puzzle: { answer: 'Tom Brady', mode: 'first_correct', settle: 'exact' } }, NOW)
    expect(made.ok).toBe(true)
    const id = h.state.challenges[0]!.id
    expect(await submitBuilderAnswer('L', 'u3', id, { text: 'Peyton' }, NOW)).toMatchObject({ ok: true })
    expect(await submitBuilderAnswer('L', 'u2', id, { text: 'tom brady' }, NOW)).toMatchObject({ ok: true })
    expect(await submitBuilderAnswer('L', 'u1', id, { text: 'TOM BRADY!' }, NOW)).toMatchObject({ ok: true })
    const board = await loadBuilderBoard('L', 'u1', NOW)
    expect(JSON.stringify(board)).not.toContain('Tom Brady')
    expect(board.challenges[0]).toMatchObject({ inputKind: 'text', mine: { answer: { text: 'TOM BRADY!' } } })
    const step = await runChallengeBuilderStep('L', AFTER_LOCK)
    expect(step.settled).toBe(1)
    expect(h.apply).toHaveBeenCalledTimes(1)
    expect(h.apply.mock.calls[0]![0]).toMatchObject({ reward: { type: 'score_bonus', rosterId: 'r2', points: 20 } })
    expect(h.state.challenges[0]!.resultSummary).toMatch(/Winners: Ben/)
  })
})

describe('position leaders', () => {
  it('settles from stored weekly fantasy points; pending until the week is final', async () => {
    const made = await createBuilderChallenge('L', 'commish', {
      ...base, title: 'QB king', question: 'Who leads QBs?', kind: 'position_leader',
      options: [{ playerId: 'qb1', label: 'Mahomes' }, { playerId: 'qb2', label: 'Allen' }], position: { sport: 'NFL', season: 2026, statWeek: 9, position: 'QB' },
    }, NOW)
    expect(made.ok).toBe(true)
    const id = h.state.challenges[0]!.id
    await submitBuilderAnswer('L', 'u1', id, { optionId: 'o1' }, NOW)
    await submitBuilderAnswer('L', 'u2', id, { optionId: 'o2' }, NOW)
    h.state.weeklyRows = [{ playerId: 'qb1', week: 9, season: 2026, fantasyPts: 18, isFinalized: false }]
    expect(await settleBuilderChallenge('L', id, { now: AFTER_LOCK })).toMatchObject({ ok: true, outcome: 'pending', pending: 'not_final' })
    h.state.weeklyRows = [{ playerId: 'qb1', week: 9, season: 2026, fantasyPts: 18, isFinalized: true }, { playerId: 'qb2', week: 9, season: 2026, fantasyPts: 27.4, isFinalized: true }]
    expect(await settleBuilderChallenge('L', id, { now: AFTER_LOCK })).toMatchObject({ ok: true, outcome: 'settled' })
    expect(h.apply.mock.calls.map((c) => c[0].reward.rosterId)).toEqual(['r2'])
  })
})

describe('anytime props outside the NFL (gap 8)', () => {
  const player = { playerId: 'p9', playerName: 'X', season: 2026, statWeek: 9 }
  it('NBA: kept, but settled by the commissioner — the runner never guesses', async () => {
    const made = await createBuilderChallenge('L', 'commish', { ...base, title: 'NBA anytime', question: '?', kind: 'anytime_td', player: { ...player, sport: 'NBA' } }, NOW)
    expect(made.ok).toBe(true)
    const id = h.state.challenges[0]!.id
    await submitBuilderAnswer('L', 'u1', id, { optionId: 'yes' }, NOW)
    expect((await runChallengeBuilderStep('L', AFTER_LOCK)).settled).toBe(0)
    expect(await settleBuilderChallenge('L', id, { now: AFTER_LOCK })).toMatchObject({ outcome: 'pending', pending: 'manual_only' })
    expect(await settleBuilderChallenge('L', id, { now: AFTER_LOCK, manual: { truth: { optionId: 'yes' } }, actorUserId: 'commish' })).toMatchObject({ outcome: 'settled' })
    expect(h.apply).toHaveBeenCalledTimes(1)
  })

  it('NHL: an anytime goal settles from the stored goals', async () => {
    await createBuilderChallenge('L', 'commish', { ...base, title: 'Goal?', question: '?', kind: 'anytime_td', player: { ...player, sport: 'NHL' } }, NOW)
    const id = h.state.challenges[0]!.id
    await submitBuilderAnswer('L', 'u1', id, { optionId: 'yes' }, NOW)
    await submitBuilderAnswer('L', 'u2', id, { optionId: 'no' }, NOW)
    h.state.weekly = { stats: { g: 1, a: 2 }, fantasyPts: 9, isFinalized: true }
    expect((await runChallengeBuilderStep('L', AFTER_LOCK)).settled).toBe(1)
    expect(h.apply.mock.calls.map((c) => c[0].reward.rosterId)).toEqual(['r1'])
  })

  it('playerStatValue reads each sport’s stored keys, null where the sport stores nothing', () => {
    expect(playerStatValue('pts', 'NBA', { pts: 31 }, 40)).toBe(31)
    expect(playerStatValue('total_td', 'NBA', { pts: 31 }, 40)).toBeNull()
    expect(playerStatValue('rush_yds', 'NBA', { pts: 31 }, 40)).toBeNull()
    expect(playerStatValue('total_td', 'NCAAFB', { rush_td: 1, rec_td: 1, pass_td: 3 }, 40)).toBe(2)
    expect(playerStatValue('hr', 'MLB', { hr: 2 }, 12)).toBe(2)
    expect(playerStatValue('total_td', 'SOCCER', { goals: 0 }, 2)).toBe(0)
    expect(playerStatValue('fantasy_points', 'NHL', {}, 7.5)).toBe(7.5)
  })
})

describe('sweep', () => {
  it('is settled by hand with the right pick per prop; tiers pay by number right', async () => {
    await createBuilderChallenge('L', 'commish', {
      ...base, title: 'Sweep', question: 'All three', kind: 'sweep', sweepTiered: true,
      props: [{ question: 'A?', options: ['y', 'n'] }, { question: 'B?', options: ['y', 'n'] }, { question: 'C?', options: ['y', 'n'] }],
      prizes: [{ place: 1, rewards: [{ type: 'score_bonus', points: 30 }] }, { place: 2, rewards: [{ type: 'score_bonus', points: 10 }] }],
    }, NOW)
    const id = h.state.challenges[0]!.id
    expect(await submitBuilderAnswer('L', 'u1', id, { picks: { p1: 'o1', p2: 'o1', p3: 'o1' } }, NOW)).toMatchObject({ ok: true })
    expect(await submitBuilderAnswer('L', 'u2', id, { picks: { p1: 'o1', p2: 'o2', p3: 'o1' } }, NOW)).toMatchObject({ ok: true })
    expect(await submitBuilderAnswer('L', 'u3', id, { picks: { p1: 'o1' } }, NOW)).toMatchObject({ ok: false, status: 400 })
    expect((await runChallengeBuilderStep('L', AFTER_LOCK)).settled).toBe(0)
    expect(await settleBuilderChallenge('L', id, { now: AFTER_LOCK, manual: { truth: { picks: { p1: 'o1', p2: 'o1' } } } })).toMatchObject({ ok: false, status: 400 })
    expect(await settleBuilderChallenge('L', id, { now: AFTER_LOCK, manual: { truth: { picks: { p1: 'o1', p2: 'o1', p3: 'o1' } } } })).toMatchObject({ outcome: 'settled' })
    expect(h.apply.mock.calls.map((c) => [c[0].reward.rosterId, c[0].reward.points])).toEqual([['r1', 30], ['r2', 10]])
  })
})

describe('Chimmy’s weekly commissioner report carries the rewards line (gap 4)', () => {
  it('appends it after the side-game line, in the league language', async () => {
    const { chimmyWeeklyReportBody } = await import('@/lib/survivor/chimmyWeeklyReport')
    const rows = [{ name: 'Seat 1', state: 'active', voted: 1, exileTeam: null }]
    const en = chimmyWeeklyReportBody(9, rows, 'en', 'Side games: quiet.', null, 'Rewards: 2 paid this week, 0 choices pending, 0 reversed.')
    expect(en.split('\n').slice(-2)).toEqual(['Side games: quiet.', 'Rewards: 2 paid this week, 0 choices pending, 0 reversed.'])
    expect(chimmyWeeklyReportBody(9, rows, 'es')).not.toMatch(/Recompensas/)
  })
})

describe('per-phase prize rules on the server (gap 2)', () => {
  it('refuses a prize the league does not allow in this phase, with a clear reason', async () => {
    h.state.phase = 'post_merge'
    h.state.merged = new Date('2026-10-20T00:00:00Z')
    h.state.settings = { survivorPrizePhaseRules: { post_merge: ['faab_grant'] } }
    const r = await createBuilderChallenge('L', 'commish', { ...base, title: 'Nope', question: '?', kind: 'last_score_type' }, NOW)
    expect(r).toMatchObject({ ok: false, status: 400, code: 'phaseType', error: 'Points cannot be given as a prize after the merge (league prize rules).' })
    const ok = await createBuilderChallenge('L', 'commish', { ...base, title: 'Yes', question: '?', kind: 'last_score_type', prizes: [{ place: 1, rewards: [{ type: 'faab_grant', amount: 5 }] }] }, NOW)
    expect(ok.ok).toBe(true)
  })
})
