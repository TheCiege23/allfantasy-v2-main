// @vitest-environment node
/**
 * The Chimmy roster boss is NBA-only. An NFL or NHL league carrying that legacy value (created
 * before the score boss, or with nothing stored) used to wait forever for a Chimmy score that is
 * never produced, so its Exile weeks never settled. It now plays the default median boss.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { effectiveExileBossMode } from '@/lib/survivor/lateSeasonSettings'

describe('effectiveExileBossMode', () => {
  it('keeps the Chimmy roster in the NBA, and uses the median everywhere else', () => {
    expect(effectiveExileBossMode('chimmy_roster', 'NBA')).toBe('chimmy_roster')
    expect(effectiveExileBossMode('chimmy_roster', 'NFL')).toBe('median')
    expect(effectiveExileBossMode('chimmy_roster', 'nhl')).toBe('median')
    expect(effectiveExileBossMode('fixed', 'NFL')).toBe('fixed')
    expect(effectiveExileBossMode('topN', 'NHL')).toBe('topN')
  })
})

const h = vi.hoisted(() => {
  const players = [
    { id: 'p1', userId: 'x1', playerState: 'exile', tokenBalance: 2 },
    { id: 'p2', userId: 'x2', playerState: 'exile', tokenBalance: 1 },
  ]
  const tx = {
    $queryRaw: vi.fn(async () => []),
    exileIsland: { findUnique: vi.fn(async () => ({ id: 'isle', isActive: true, bossWinsEnabled: true, bossTokenResetOnWin: true, currentWeek: 5 })), update: vi.fn() },
    survivorAuditEntry: {
      findFirst: vi.fn(async ({ where }: any) => (where.action === 'exile_results_finalized' ? { id: 'fin', data: { source: 'closed_exile_rosters_v1', userIds: ['x1', 'x2'] } } : null)),
      create: vi.fn(),
    },
    league: { findUnique: vi.fn(async () => ({ survivorTokenCap: null, sport: h.sport, settings: { exileBossMode: 'chimmy_roster' } })) },
    survivorWeeklyScore: { findMany: vi.fn(async () => [{ finalScore: 90 }, { finalScore: 100 }, { finalScore: 110 }]) },
    exileWeeklyEntry: { findMany: vi.fn(async () => [{ id: 'e1', userId: 'x1', weeklyScore: 120 }, { id: 'e2', userId: 'x2', weeklyScore: 80 }]), update: vi.fn() },
    survivorPlayer: { findUnique: vi.fn(async ({ where }: any) => players.find(p => p.userId === where.leagueId_userId.userId) ?? null), update: vi.fn(), findMany: vi.fn(async () => []) },
    survivorIdol: { findMany: vi.fn(async () => []) },
  }
  return { tx, sport: 'NFL' }
})
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: (fn: (tx: unknown) => unknown) => fn(h.tx) } }))
vi.mock('@/lib/survivor/hostEngine', () => ({ postHostMessage: vi.fn() }))
vi.mock('@/lib/survivor/auditEntry', () => ({ logSurvivorAuditEntry: vi.fn() }))
vi.mock('@/lib/survivor/survivorExileLifecycle', () => ({ resolveScheduledExileReturn: vi.fn() }))

import { scoreExileWeek } from '@/lib/survivor/exileEngine'

describe('scoreExileWeek on a legacy Chimmy-boss league', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('an NFL league settles against the median: the top score wins a token, the one below loses theirs', async () => {
    h.sport = 'NFL'
    expect(await scoreExileWeek('L1', 6)).toBe(true)
    expect(h.tx.survivorAuditEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'exile_week_scored', data: expect.objectContaining({ bossScore: 100, bossMode: 'median', winnerUserId: 'x1' }) }) })
    expect(h.tx.survivorPlayer.update).toHaveBeenCalledWith({ where: { id: 'p2' }, data: { tokenBalance: 0 } })
  })

  it('an NBA league still waits for the Chimmy roster result', async () => {
    h.sport = 'NBA'
    expect(await scoreExileWeek('L1', 6)).toBe(false)
    expect(h.tx.survivorAuditEntry.create).not.toHaveBeenCalled()
  })
})
