/**
 * How Chimmy plays Survivor for a castaway it runs: vote out the weakest before the merge (keep the
 * tribe strong), the biggest threat after it, and play a protective idol when it is the likely target.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({
  ctx: null as Record<string, unknown> | null,
  settings: {} as Record<string, unknown>,
  scores: [] as Array<{ userId: string; week: number; finalScore: number; isFinalized: boolean }>,
  votes: [] as Array<{ voterUserId: string }>,
  idol: null as { id: string } | null,
  submitted: [] as Array<[string, string]>,
  played: [] as string[],
  lines: [] as Array<[string, unknown]>,
}))
vi.mock('@/lib/survivor/chimmyCastawayChat', () => ({ postChimmyCastawayLine: vi.fn(async (_l: string, userId: string, line: unknown) => { h.lines.push([userId, line]); return true }) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ settings: h.settings })) },
    survivorWeeklyScore: { findMany: vi.fn(async () => h.scores) },
    survivorVote: { findMany: vi.fn(async () => h.votes) },
    survivorIdol: { findFirst: vi.fn(async () => h.idol) },
  },
}))
vi.mock('@/lib/survivor/survivorCouncilService', () => ({ loadCouncilContext: vi.fn(async () => h.ctx) }))
vi.mock('@/lib/survivor/survivorVoteService', () => ({ submitVote: vi.fn(async (_l: string, voter: string, target: string) => { h.submitted.push([voter, target]); return { ok: true } }) }))
vi.mock('@/lib/survivor/idolEngine', () => ({ playIdol: vi.fn(async (idolId: string) => { h.played.push(idolId); return { ok: true, message: 'played' } }) }))

import { CHIMMY_PROTECTIVE_POWERS, chimmyAtRisk, chimmyVoteTarget, councilIsMerged } from '@/lib/survivor/chimmyCastawayStrategy'
import { runChimmyCouncilTurn } from '@/lib/survivor/chimmyCastaway'

const t = (userId: string, seasonPoints: number, weekPoints = 0) => ({ userId, seasonPoints, weekPoints })

describe('Chimmy\'s Survivor decisions', () => {
  it('before the merge votes out the weakest season scorer; after it, the biggest threat', () => {
    const field = [t('strong', 300), t('mid', 200), t('weak', 100)]
    expect(chimmyVoteTarget(field, false)).toBe('weak')
    expect(chimmyVoteTarget(field, true)).toBe('strong')
    expect(chimmyVoteTarget([], true)).toBeNull()
    // Ties break by this week, then id, so the choice is stable.
    expect(chimmyVoteTarget([t('b', 100, 5), t('a', 100, 9)], false)).toBe('b')
  })

  it('knows when it is the likely target', () => {
    const field = [t('chimmy', 90), t('x', 100), t('y', 200), t('z', 300)]
    expect(chimmyAtRisk('chimmy', field, false)).toBe(true)
    expect(chimmyAtRisk('y', field, false)).toBe(false)
    expect(chimmyAtRisk('z', field, true)).toBe(true)
    expect(chimmyAtRisk('y', field, true)).toBe(false)
    expect(chimmyAtRisk('chimmy', field.slice(0, 2), false)).toBe(false)
  })

  it('reads the merge from the council', () => {
    expect(councilIsMerged('pre_merge', 'tribe-1')).toBe(false)
    expect(councilIsMerged('merge', null)).toBe(true)
    expect(councilIsMerged('jury', null)).toBe(true)
  })
})

const chimmyEntry = { since: 's', byUserId: 'c', ownerUserId: 'orphan-r9', autopilot: { style: 'dynasty_owner', since: 's', byUserId: 'c' } }

beforeEach(() => {
  h.settings = { af_managed_lineups: { r9: chimmyEntry } }
  h.ctx = {
    council: { id: 'c1', week: 4, phase: 'pre_merge', status: 'voting_open', isRevealed: false, attendingTribeId: 't1' },
    eligibility: {
      voterUserIds: ['orphan-r9', 'u1', 'u2', 'u3'],
      targetUserIds: ['orphan-r9', 'u1', 'u2', 'u3'],
      targetsByVoter: { 'orphan-r9': ['u1', 'u2', 'u3'] },
    },
    userToRoster: { 'orphan-r9': 'r9', u1: 'r1', u2: 'r2', u3: 'r3' },
  }
  h.scores = [
    { userId: 'orphan-r9', week: 3, finalScore: 150, isFinalized: true },
    { userId: 'u1', week: 3, finalScore: 300, isFinalized: true },
    { userId: 'u2', week: 3, finalScore: 120, isFinalized: true },
    { userId: 'u3', week: 3, finalScore: 200, isFinalized: true },
  ]
  h.votes = []
  h.idol = null
  h.submitted = []
  h.played = []
  h.lines = []
})

describe('Chimmy\'s turn at an open council', () => {
  it('votes once, through the ballot service, for the weakest before the merge', async () => {
    const turn = await runChimmyCouncilTurn('L', 'c1')
    expect(h.submitted).toEqual([['orphan-r9', 'u2']])
    expect(turn.voted).toEqual(['orphan-r9'])
    // One in-character line to its tribe, which names nobody.
    expect(h.lines).toEqual([['orphan-r9', { kind: 'vote', week: 4 }]])
  })

  it('does not vote again once its ballot is in', async () => {
    h.votes = [{ voterUserId: 'orphan-r9' }]
    await runChimmyCouncilTurn('L', 'c1')
    expect(h.submitted).toEqual([])
    expect(h.lines).toEqual([])
  })

  it('counts only real vote-cancelling idols as protective', () => {
    expect([...CHIMMY_PROTECTIVE_POWERS].sort()).toEqual(['protect_self', 'protect_self_plus_one'])
  })

  it('plays a protective idol when it is the likely target', async () => {
    h.scores = h.scores.map((s) => (s.userId === 'orphan-r9' ? { ...s, finalScore: 50 } : s))
    h.idol = { id: 'idol-1' }
    const turn = await runChimmyCouncilTurn('L', 'c1')
    expect(h.played).toEqual(['idol-1'])
    expect(turn.idolsPlayed).toEqual(['orphan-r9'])
  })

  it('keeps its idol when it is safe', async () => {
    h.idol = { id: 'idol-1' }
    h.scores = h.scores.map((s) => (s.userId === 'orphan-r9' ? { ...s, finalScore: 999 } : s))
    await runChimmyCouncilTurn('L', 'c1')
    expect(h.played).toEqual([])
  })

  it('CONTROL: a seat Chimmy does not run, and a council that has closed, get nothing', async () => {
    h.settings = {}
    await runChimmyCouncilTurn('L', 'c1')
    expect(h.submitted).toEqual([])
    h.settings = { af_managed_lineups: { r9: chimmyEntry } }
    h.ctx = { ...h.ctx!, council: { ...(h.ctx!.council as object), status: 'voting_closed' } }
    await runChimmyCouncilTurn('L', 'c1')
    expect(h.submitted).toEqual([])
  })
})
