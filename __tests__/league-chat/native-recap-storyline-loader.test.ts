// @vitest-environment node
/**
 * The native weekly recap carries the week's storylines and awards (lib/league-chat/nativeWeeklyRecap.ts): rivalry
 * results by the league's rivalry scores, a trade completed this week, the week's awards from the shared awards
 * calculator, and a recap that still posts when a storyline read fails.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const games = [
  { week: 1, homeRosterId: 'rA', awayRosterId: 'rB', homeScore: 120, awayScore: 90, status: 'final', isMedianMatchup: false },
  { week: 2, homeRosterId: 'rB', awayRosterId: 'rA', homeScore: 101, awayScore: 99, status: 'final', isMedianMatchup: false },
]
const rivalry = vi.hoisted(() => ({ pairs: vi.fn(async () => new Set(['rA|rB'])) }))
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
// The recap names rivalry games by the same scores rivalry week pairs from; that module has its own tests.
vi.mock('@/lib/schedule-runtime/rivalryWeekService', () => ({ loadSeasonRivalryPairKeys: rivalry.pairs }))

import { buildNativeRecapForLeague } from '@/lib/league-chat/nativeWeeklyRecap'

const rosters = [{ id: 'rA', ownerId: 'uA', teamName: 'Aces', ownerName: 'a' }, { id: 'rB', ownerId: 'uB', teamName: 'Bears', ownerName: 'b' }]

beforeEach(() => {
  vi.clearAllMocks()
  db.redraftSeason.findUnique.mockResolvedValue({ id: 's1', season: 2026, sport: 'NFL' })
  rivalry.pairs.mockResolvedValue(new Set(['rA|rB']))
  db.redraftMatchup.findFirst.mockResolvedValue({ week: 2 })
  db.redraftMatchup.findMany.mockImplementation(async (args: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
    if ('homeRoster' in args.select) {
      return [{ status: 'final', homeScore: 101, awayScore: 99, homeRoster: { teamName: 'Bears', ownerName: 'b' }, awayRoster: { teamName: 'Aces', ownerName: 'a' } }]
    }
    if ('lineupSnapshots' in args.select) return [{ week: 2, homeRosterId: 'rB', awayRosterId: 'rA', homeScore: 101, awayScore: 99, status: 'final', lineupSnapshots: null }]
    const week = args.where.week
    return typeof week === 'number' ? games.filter((g) => g.week === week) : games
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
  it('adds rivalry week, the rivalry result and a trade, plus the shared weekly awards, named by team', async () => {
    const out = await buildNativeRecapForLeague({ leagueId: 'L1', leagueName: 'Gridiron', seasonYear: 2026 })
    expect(out.ok).toBe(true)
    const text = (out as { text: string }).text
    expect(text).toContain('📰 Storylines')
    expect(text).toContain('🔥 It was rivalry week.')
    expect(text).toContain('⚔️ Rivalry: Bears beat Aces')
    // The awards come from the shared calculator, worded as the Sleeper recap words them.
    expect(text).toContain('🏆 Weekly awards')
    expect(text).toContain('🚀 Boom of the week: Bears, 101.0')
    expect(text).toContain('🥀 Bust of the week: Aces, 99.0')
    expect(text).toContain('😅 Narrow escape: Bears over Aces by 2.0')
    expect(text).not.toContain('Closest game')
    expect(rivalry.pairs).toHaveBeenCalledWith({ leagueId: 'L1', rosters })
    expect(text).toContain('🤝 Trade completed: Aces and Bears')
    expect(text.indexOf('📰 Storylines')).toBeLessThan(text.indexOf('Every result comes from finalized AllFantasy matchups.'))
  })

  it('a storyline read that fails still leaves a correct recap', async () => {
    rivalry.pairs.mockRejectedValue(new Error('db down'))
    db.roster.findMany.mockRejectedValue(new Error('db down'))
    const out = await buildNativeRecapForLeague({ leagueId: 'L1', leagueName: 'Gridiron', seasonYear: 2026 })
    expect(out.ok).toBe(true)
    expect((out as { text: string }).text).toContain('Bears 101.0 def. Aces 99.0')
  })

  it('[control] awards are for the week being recapped only: week 2 awards never name week 1', async () => {
    const out = await buildNativeRecapForLeague({ leagueId: 'L1', leagueName: 'Gridiron', seasonYear: 2026 })
    expect((out as { text: string }).text).not.toContain('120.0')
  })
})
