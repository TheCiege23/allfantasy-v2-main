import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => {
  const db = {
    league: { findUnique: vi.fn() }, exileIsland: { findUnique: vi.fn() },
    survivorGameState: { findUnique: vi.fn() }, survivorAuditEntry: { findUnique: vi.fn(), create: vi.fn() },
    gameSchedule: { findMany: vi.fn() }, player: { findMany: vi.fn() }, playerWeeklyScore: { findUnique: vi.fn() },
  }
  return { db }
})
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: (_leagueId: string, work: (db: typeof m.db) => unknown) => work(m.db) }))
vi.mock('@/lib/survivor/exileRosterService', () => ({ exileWeekWindow: async () => ({ start: new Date('2026-10-20T04:00:00Z'), end: new Date('2026-10-27T04:00:00Z') }) }))
vi.mock('@/lib/redraft/scoringEngine', () => ({ buildLeagueStatScorer: () => (stats: Record<string, number>) => stats.pts }))

import { finalizeChimmyExileBossScore, lockChimmyExileRoster } from '@/lib/survivor/exileChimmyBoss'

const league = { platform: 'allfantasy', sport: 'NBA', season: 2026, survivorMode: true, settings: { commissionerParticipationMode: 'participating_player', starter_slots: { PG: 1, SG: 1, BN: 1 } }, scoring: {} }
const now = new Date('2026-10-20T12:00:00Z')

beforeEach(() => {
  vi.resetAllMocks()
  m.db.league.findUnique.mockResolvedValue(league)
  m.db.exileIsland.findUnique.mockResolvedValue({ isActive: true, bossWinsEnabled: true })
  m.db.survivorGameState.findUnique.mockResolvedValue({ phase: 'pre_merge' })
  m.db.survivorAuditEntry.findUnique.mockResolvedValue(null)
  m.db.gameSchedule.findMany.mockResolvedValue([{ homeTeam: 'BOS', awayTeam: 'NYK', startTime: new Date('2026-10-20T23:00:00Z') }])
  m.db.player.findMany.mockResolvedValue([
    { id: 'bos-pg', name: 'Boston Guard', position: 'PG', team: 'BOS', draftProjectionScore: 30 },
    { id: 'bos-sg', name: 'Boston Wing', position: 'SG', team: 'BOS', draftProjectionScore: 20 },
  ])
})

describe('Chimmy Exile boss', () => {
  it('locks a PG-first, same-team starter roster before the first NBA game', async () => {
    expect(await lockChimmyExileRoster('league', now)).toBe(true)
    const saved = m.db.survivorAuditEntry.create.mock.calls[0][0].data
    expect(saved.action).toBe('exile_boss_roster_locked')
    expect(saved.data.roster.players).toEqual([
      expect.objectContaining({ id: 'bos-pg', slot: 'PG', team: 'BOS' }),
      expect.objectContaining({ id: 'bos-sg', slot: 'SG', team: 'BOS' }),
    ])
    expect(saved.data.roster.lockedAt).toBe(now.toISOString())
  })

  it('does not choose after the first tipoff', async () => {
    expect(await lockChimmyExileRoster('league', new Date('2026-10-20T23:00:00Z'))).toBe(false)
    expect(m.db.survivorAuditEntry.create).not.toHaveBeenCalled()
  })

  it('locks the same automated contest for a non-playing commissioner', async () => {
    m.db.league.findUnique.mockResolvedValue({ ...league, settings: { ...league.settings, commissionerParticipationMode: 'non_participating_host' } })
    expect(await lockChimmyExileRoster('league', now)).toBe(true)
    expect(m.db.survivorAuditEntry.create.mock.calls[0][0].data.action).toBe('exile_boss_roster_locked')
  })

  it('does not place a native roster into an imported league', async () => {
    m.db.league.findUnique.mockResolvedValue({ ...league, platform: 'sleeper' })
    expect(await lockChimmyExileRoster('league', now)).toBe(false)
    expect(m.db.survivorAuditEntry.create).not.toHaveBeenCalled()
  })

  it('precommits before a manager is sent to Exile but never during the draft', async () => {
    expect(await lockChimmyExileRoster('league', now)).toBe(true)
    m.db.survivorAuditEntry.create.mockClear()
    m.db.survivorGameState.findUnique.mockResolvedValue({ phase: 'drafting' })
    expect(await lockChimmyExileRoster('league', now)).toBe(false)
    expect(m.db.survivorAuditEntry.create).not.toHaveBeenCalled()
  })

  it('publishes a boss score only after every locked player has a final stat row', async () => {
    expect(await lockChimmyExileRoster('league', now)).toBe(true)
    const saved = m.db.survivorAuditEntry.create.mock.calls[0][0].data
    m.db.survivorAuditEntry.findUnique.mockImplementation(async ({ where }) => where.id.includes('roster:') ? { data: saved.data } : null)
    m.db.playerWeeklyScore.findUnique.mockImplementation(async ({ where }) => ({ isFinalized: where.playerId_week_season_sport.playerId === 'bos-pg', stats: { pts: 10 } }))
    expect(await finalizeChimmyExileBossScore('league', 1, new Date('2026-10-27T05:00:00Z'))).toBe(false)
    m.db.playerWeeklyScore.findUnique.mockImplementation(async ({ where }) => ({ isFinalized: true, stats: { pts: where.playerId_week_season_sport.playerId === 'bos-pg' ? 10 : 5 } }))
    expect(await finalizeChimmyExileBossScore('league', 1, new Date('2026-10-27T05:00:00Z'))).toBe(true)
    expect(m.db.survivorAuditEntry.create.mock.calls[1][0].data).toMatchObject({ action: 'exile_boss_result_finalized', data: { score: 15, source: 'locked_chimmy_nba_roster_v1' } })
  })
})
