// @vitest-environment node
/**
 * The native weekly recap carries the week's storylines (lib/league-chat/nativeWeeklyRecap.ts, 2026-11-15): rivalry
 * results through the roster link, a trade completed this week, and a recap that still posts when a storyline read fails.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const games = [
  { week: 1, homeRosterId: 'rA', awayRosterId: 'rB', homeScore: 120, awayScore: 90 },
  { week: 2, homeRosterId: 'rB', awayRosterId: 'rA', homeScore: 101, awayScore: 99 },
]
const db = vi.hoisted(() => ({
  redraftSeason: { findUnique: vi.fn(), findFirst: vi.fn() },
  redraftMatchup: { findFirst: vi.fn(), findMany: vi.fn() },
  redraftRoster: { findMany: vi.fn() },
  roster: { findMany: vi.fn() },
  rivalryRecord: { findMany: vi.fn() },
  leagueAuditLog: { findFirst: vi.fn() },
  redraftTradeProposal: { findMany: vi.fn() },
  afLeagueTrade: { findMany: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn(async () => []) },
  leaguePlayerWeeklyScore: { findMany: vi.fn(async () => []) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/league-chat/chimmyMoments', () => ({ postChimmyMoment: vi.fn() }))

import { buildNativeRecapForLeague } from '@/lib/league-chat/nativeWeeklyRecap'

const rosters = [{ id: 'rA', teamName: 'Aces', ownerName: 'a' }, { id: 'rB', teamName: 'Bears', ownerName: 'b' }]

beforeEach(() => {
  vi.clearAllMocks()
  db.redraftSeason.findUnique.mockResolvedValue({ id: 's1', season: 2026 })
  db.redraftMatchup.findFirst.mockResolvedValue({ week: 2 })
  db.redraftMatchup.findMany.mockImplementation(async (args: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
    if ('homeRoster' in args.select) {
      return [{ status: 'final', homeScore: 101, awayScore: 99, homeRoster: { teamName: 'Bears', ownerName: 'b' }, awayRoster: { teamName: 'Aces', ownerName: 'a' } }]
    }
    if ('lineupSnapshots' in args.select) return [{ week: 2, homeRosterId: 'rB', awayRosterId: 'rA', homeScore: 101, awayScore: 99, status: 'final', lineupSnapshots: null }]
    return games
  })
  db.redraftRoster.findMany.mockImplementation(async (args: { take?: number }) =>
    args.take ? rosters.map((r) => ({ ...r, wins: 1, losses: 1, ties: 0, pointsFor: 200 })) : rosters,
  )
  db.roster.findMany.mockResolvedValue([{ id: 'gA', redraftRosterId: 'rA' }, { id: 'gB', redraftRosterId: 'rB' }])
  db.rivalryRecord.findMany.mockResolvedValue([{ managerAId: 'gA', managerBId: 'gB' }])
  db.leagueAuditLog.findFirst.mockResolvedValue({ metadata: { week: 2 } })
  db.redraftTradeProposal.findMany.mockResolvedValue([])
  db.afLeagueTrade.findMany.mockResolvedValue([{ proposerRosterId: 'gA', receiverRosterId: 'gB' }])
})

describe('the recap\'s storylines', () => {
  it('adds rivalry week, the rivalry result, the closest game and a trade, named by team', async () => {
    const out = await buildNativeRecapForLeague({ leagueId: 'L1', leagueName: 'Gridiron', seasonYear: 2026 })
    expect(out.ok).toBe(true)
    const text = (out as { text: string }).text
    expect(text).toContain('📰 Storylines')
    expect(text).toContain('🔥 It was rivalry week.')
    expect(text).toContain('⚔️ Rivalry: Bears beat Aces')
    expect(text).toContain('🎯 Closest game: Bears over Aces by 2.0')
    expect(text).toContain('🤝 Trade completed: Aces and Bears')
    expect(text.indexOf('📰 Storylines')).toBeLessThan(text.indexOf('Every result comes from finalized AllFantasy matchups.'))
  })

  it('a storyline read that fails still leaves a correct recap', async () => {
    db.rivalryRecord.findMany.mockRejectedValue(new Error('db down'))
    db.roster.findMany.mockRejectedValue(new Error('db down'))
    const out = await buildNativeRecapForLeague({ leagueId: 'L1', leagueName: 'Gridiron', seasonYear: 2026 })
    expect(out.ok).toBe(true)
    expect((out as { text: string }).text).toContain('Bears 101.0 def. Aces 99.0')
  })
})
