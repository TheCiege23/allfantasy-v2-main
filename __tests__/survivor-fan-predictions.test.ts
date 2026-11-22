import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fanChoices, fanLeaderboard, openFanCouncil, type FanCastawayRow, type FanCouncilRow } from '@/lib/survivor/spectator/fanPredictionsModel'

const NOW = new Date('2026-10-20T01:00:00Z')

const council = (over: Partial<FanCouncilRow> = {}): FanCouncilRow => ({
  id: 'c3', week: 3, councilNumber: 1, status: 'voting', closedAt: null, voteDeadlineAt: new Date('2026-10-20T03:00:00Z'),
  attendingTribeId: 't1', eliminatedUserId: null, eliminatedName: null, isTie: false, tiePhase: null,
  isRevealed: false, revealStartsAt: null, revealStep: 0, revealSequence: null,
  ...over,
})
const read = (id: string, eliminatedUserId: string, week = 2): FanCouncilRow => council({
  id, week, status: 'closed', closedAt: new Date(0), voteDeadlineAt: new Date(0), eliminatedUserId,
  isRevealed: true, revealStartsAt: new Date(0), revealSequence: [{ targetName: 'X', status: 'counts' }],
})
const players: FanCastawayRow[] = [
  { id: 'p1', userId: 'u1', displayName: 'Ace', tribeId: 't1', playerState: 'active' },
  { id: 'p2', userId: 'u2', displayName: 'Bo', tribeId: 't1', playerState: 'active' },
  { id: 'p3', userId: 'u3', displayName: 'Cy', tribeId: 't2', playerState: 'active' },
  { id: 'p4', userId: 'u4', displayName: 'Di', tribeId: 't1', playerState: 'eliminated' },
]

describe('fan prediction rules', () => {
  it('calls open only on the latest council while its votes are open', () => {
    expect(openFanCouncil([read('c2', 'u4'), council()], NOW)?.id).toBe('c3')
    expect(openFanCouncil([council({ voteDeadlineAt: new Date(NOW.getTime() - 1) })], NOW)).toBeNull()
    expect(openFanCouncil([council({ closedAt: new Date(0) })], NOW)).toBeNull()
    expect(openFanCouncil([council({ isRevealed: true })], NOW)).toBeNull()
    expect(openFanCouncil([], NOW)).toBeNull()
  })

  it('choices are the attending tribe still in the game, by key and name only', () => {
    expect(fanChoices(council(), players, new Set())).toEqual([{ key: 'p1', name: 'Ace' }, { key: 'p2', name: 'Bo' }])
    expect(fanChoices(council({ attendingTribeId: null }), players, new Set()).map(c => c.name)).toEqual(['Ace', 'Bo', 'Cy'])
  })

  it('a castaway whose own elimination has not been read stays a choice, so the list cannot spoil it', () => {
    expect(fanChoices(council(), players, new Set(['u4'])).map(c => c.name)).toEqual(['Ace', 'Bo', 'Di'])
  })

  it('the leaderboard counts a call only once its council read is complete', () => {
    const predictions = [
      { councilId: 'c2', fanUserId: 'f1', pickedUserId: 'u4' },
      { councilId: 'c2', fanUserId: 'f2', pickedUserId: 'u1' },
      { councilId: 'c3', fanUserId: 'f2', pickedUserId: 'u2' },
    ]
    expect(fanLeaderboard(predictions, [read('c2', 'u4'), council()], null, NOW)).toEqual([
      { fanUserId: 'f1', correct: 1, calls: 1 },
      { fanUserId: 'f2', correct: 0, calls: 1 },
    ])
    // A read still in progress scores nothing yet.
    const reading = { ...read('c2', 'u4'), revealStartsAt: new Date(NOW.getTime() - 100), revealSequence: [{ targetName: 'X' }, { targetName: 'Y' }] }
    expect(fanLeaderboard(predictions, [reading], 'one_at_a_time', NOW)).toEqual([])
  })
})

const h = vi.hoisted(() => ({
  settings: { spectatorPageEnabled: true } as Record<string, unknown>,
  councils: [] as unknown[],
  member: false,
  predictions: vi.fn(),
  upsert: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => (h.member ? { role: 'member' } : null)) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ settings: h.settings, survivorRevealMode: null })) },
    survivorTribalCouncil: { findMany: vi.fn(async () => h.councils) },
    survivorPlayer: { findMany: vi.fn(async () => players) },
    survivorTribe: { findMany: vi.fn(async () => [{ id: 't1', name: 'Tala' }]) },
    survivorFanPrediction: { findMany: h.predictions, upsert: h.upsert },
    appUser: { findMany: vi.fn(async () => [{ id: 'f1', username: 'islandfan' }]) },
  },
}))

import { getFanPredictionState, submitFanPrediction } from '@/lib/survivor/spectator/fanPredictions'

describe('fan prediction service', () => {
  beforeEach(() => {
    h.settings = { spectatorPageEnabled: true }
    h.councils = [read('c2', 'u4'), council()]
    h.member = false
    h.predictions.mockReset().mockResolvedValue([{ councilId: 'c2', fanUserId: 'f1', pickedUserId: 'u4' }, { councilId: 'c3', fanUserId: 'f1', pickedUserId: 'u2' }])
    h.upsert.mockReset().mockResolvedValue({})
  })

  it('shows the open call, the fan\'s own pick by key, and the leaderboard by username, with no user ids', async () => {
    const state = await getFanPredictionState('L1', 'f1', NOW)
    expect(state).toMatchObject({
      available: true,
      open: { week: 3, tribeName: 'Tala', choices: [{ key: 'p1', name: 'Ace' }, { key: 'p2', name: 'Bo' }] },
      signedIn: true, blocked: null, myPick: 'p2', myRecord: { correct: 1, calls: 1 },
      leaders: [{ name: 'islandfan', correct: 1, calls: 1 }],
    })
    expect(JSON.stringify(state)).not.toMatch(/"u\d"|f1/)
  })

  it('a league member is told they cannot call it, and a POST from them is refused', async () => {
    h.member = true
    expect((await getFanPredictionState('L1', 'm1', NOW)).blocked).toBe('league_member')
    expect(await submitFanPrediction('L1', 'm1', 'p1', NOW)).toMatchObject({ ok: false, status: 403 })
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('a fan call saves the castaway, and only for one at this council', async () => {
    expect(await submitFanPrediction('L1', 'f9', 'p1', NOW)).toEqual({ ok: true, myPick: 'p1' })
    expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ councilId: 'c3', fanUserId: 'f9', pickedUserId: 'u1', week: 3 }) }))
    expect(await submitFanPrediction('L1', 'f9', 'p3', NOW)).toMatchObject({ ok: false, status: 400 })
    h.councils = [read('c2', 'u4')]
    expect(await submitFanPrediction('L1', 'f9', 'p1', NOW)).toMatchObject({ ok: false, status: 409 })
  })

  it('off when the watch page is off, and off (not broken) before the table is migrated', async () => {
    h.settings = {}
    expect((await getFanPredictionState('L1', 'f1', NOW)).available).toBe(false)
    expect(await submitFanPrediction('L1', 'f1', 'p1', NOW)).toMatchObject({ ok: false, status: 404 })
    h.settings = { spectatorPageEnabled: true }
    h.predictions.mockRejectedValue(Object.assign(new Error('missing'), { code: 'P2021' }))
    expect((await getFanPredictionState('L1', 'f1', NOW)).available).toBe(false)
    h.upsert.mockRejectedValue(Object.assign(new Error('missing'), { code: 'P2021' }))
    expect(await submitFanPrediction('L1', 'f9', 'p1', NOW)).toMatchObject({ ok: false, status: 503 })
  })
})
