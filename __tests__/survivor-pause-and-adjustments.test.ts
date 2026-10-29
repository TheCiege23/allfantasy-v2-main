import { beforeEach, describe, expect, it, vi } from 'vitest'

type ScoreRow = { leagueId: string; userId: string; week: number; fantasyScore: number; pointBoostApplied: number; pointPenaltyApplied: number; finalScore: number; tribeId: string | null; countedTowardTribeTotal: boolean; correctionApplied?: boolean }

const store = vi.hoisted(() => ({ scores: new Map<string, ScoreRow>(), game: {} as Record<string, unknown> }))
const key = (where: { leagueId_userId_week: { leagueId: string; userId: string; week: number } }) => {
  const k = where.leagueId_userId_week
  return `${k.leagueId}:${k.userId}:${k.week}`
}
const db = vi.hoisted(() => ({
  survivorGameState: { findUnique: vi.fn(), update: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  survivorPlayer: { findMany: vi.fn() },
  league: { findUnique: vi.fn() },
  survivorWeeklyScore: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
  survivorCommissionerAction: { create: vi.fn() },
}))
const nbaScore = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/survivor/survivorNbaWeeklyScoring', () => ({ scoreNbaSurvivorAllGamesRoster: nbaScore, scoreNbaSurvivorOneGameRoster: nbaScore }))
vi.mock('@/lib/survivor/SurvivorSitOutEngine', () => ({ applySurvivorSitOutToScoring: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'commish' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: vi.fn(async () => undefined) }))
vi.mock('@/lib/survivor/survivorHostGuard', () => ({ survivorHostGuard: vi.fn(async () => null) }))

import { syncWeeklyScores } from '@/lib/survivor/gameStateMachine'
import { POST } from '@/app/api/survivor/commissioner/route'

function adjust(amount: number) {
  return POST(new Request('http://test/api/survivor/commissioner', {
    method: 'POST',
    body: JSON.stringify({ action: 'adjust_score', leagueId: 'league-1', userId: 'user-1', week: 3, adjustmentAmount: amount }),
  }) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  store.scores.clear()
  store.game = { leagueId: 'league-1', pausedSnapshot: null }
  db.survivorGameState.findUnique.mockImplementation(async () => store.game)
  db.survivorGameState.update.mockImplementation(async ({ data }) => Object.assign(store.game, data))
  db.redraftSeason.findFirst.mockResolvedValue({ id: 'season-1', leagueId: 'league-1', season: 2026 })
  db.survivorPlayer.findMany.mockResolvedValue([{ userId: 'user-1', redraftRosterId: 'roster-1', tribeId: 'tribe-a' }])
  db.league.findUnique.mockResolvedValue({ sport: 'NBA', survivorMode: true, settings: {}, survivorPhase: 'pre_merge' })
  nbaScore.mockResolvedValue({ pts: 100, allFinalized: false })
  db.survivorWeeklyScore.findUnique.mockImplementation(async ({ where }) => store.scores.get(key(where)) ?? null)
  db.survivorWeeklyScore.upsert.mockImplementation(async ({ where, create, update }) => {
    const k = key(where)
    const row = store.scores.get(k)
    const next = row ? { ...row, ...update } : { tribeId: null, countedTowardTribeTotal: true, pointBoostApplied: 0, pointPenaltyApplied: 0, fantasyScore: 0, ...create }
    store.scores.set(k, next)
    return next
  })
  db.survivorWeeklyScore.findMany.mockImplementation(async () => [...store.scores.values()])
})

describe('commissioner score adjustments', () => {
  it('survive the next score sync instead of being recomputed away', async () => {
    await syncWeeklyScores('league-1', 3)
    expect(store.scores.get('league-1:user-1:3')?.finalScore).toBe(100)

    expect((await adjust(5)).status).toBe(200)
    expect(store.scores.get('league-1:user-1:3')?.finalScore).toBe(105)
    await syncWeeklyScores('league-1', 3)
    expect(store.scores.get('league-1:user-1:3')?.finalScore).toBe(105)

    expect((await adjust(-8)).status).toBe(200)
    await syncWeeklyScores('league-1', 3)
    expect(store.scores.get('league-1:user-1:3')).toMatchObject({ finalScore: 97, pointBoostApplied: 5, pointPenaltyApplied: 8 })
  })
})

describe('a paused season', () => {
  it('is not rescored and keeps its pause marker', async () => {
    store.game = { leagueId: 'league-1', pausedSnapshot: { needsTribalLock: true }, lastError: 'PAUSED: commissioner' }
    await syncWeeklyScores('league-1', 3)
    expect(db.survivorWeeklyScore.upsert).not.toHaveBeenCalled()
    expect(db.survivorGameState.update).not.toHaveBeenCalled()
    expect(store.game.lastError).toBe('PAUSED: commissioner')
  })
})
