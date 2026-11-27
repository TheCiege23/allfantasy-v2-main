/**
 * The League page's matchup cards (server/services/nativeLeagueWeekCards.ts): every game this week from the
 * same reads as the Matchup tab — scoreboard, saved lineup, AF projections, win chance.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const findMany = vi.fn()
vi.mock('@/lib/prisma', () => ({ prisma: { redraftRosterPlayer: { findMany: (...a: unknown[]) => findMany(...a) } } }))
vi.mock('@/lib/redraft/weekLineupSlots', () => ({
  loadWeekLineups: vi.fn(async () => new Map()),
  weekSlotType: (p: { slotType: string }) => p.slotType,
}))
vi.mock('@/lib/scoring-runtime', () => ({ isNflRedraftScoringStarterSlot: (s: string) => s === 'starter' }))
const af = vi.fn()
vi.mock('@/lib/matchup-center/afProjections', async () => {
  const real = await vi.importActual<typeof import('@/lib/matchup-center/afProjections')>('@/lib/matchup-center/afProjections')
  return { ...real, loadMatchupAfProjections: (...a: unknown[]) => af(...a) }
})
vi.mock('@/lib/core-app/leagueArt', () => ({ managerArtUrl: ({ avatarUrl }: { avatarUrl: string | null }) => avatarUrl }))
const season = {
  id: 's', season: 2026, currentWeek: 7, playoffStartWeek: 20,
  rosters: [
    { id: 'r1', ownerId: 'u1', managerUserId: null, ownerName: 'A', teamName: 'Ghosts', avatarUrl: 'https://x/a.png', wins: 3, losses: 1, ties: 0 },
    { id: 'r2', ownerId: 'me', managerUserId: null, ownerName: 'B', teamName: 'Owls', avatarUrl: null, wins: 0, losses: 0, ties: 0 },
    { id: 'r3', ownerId: 'u3', managerUserId: null, ownerName: 'C', teamName: 'Mob', avatarUrl: null, wins: 2, losses: 1, ties: 1 },
    { id: 'r4', ownerId: 'u4', managerUserId: null, ownerName: 'D', teamName: 'Tanks', avatarUrl: null, wins: 1, losses: 3, ties: 0 },
  ],
}
const games = vi.fn()
vi.mock('@/server/services/nativeMatchupCenter', () => ({
  loadNativeMatchupSeason: vi.fn(async () => season),
  loadNativeScoreboard: vi.fn(async () => ({ season: 2026, week: 7, games: games() })),
}))

import { loadNativeLeagueWeekCards } from '@/server/services/nativeLeagueWeekCards'

const league = { id: 'lg1', season: 2026, sport: 'NBA', settings: {}, leagueVariant: null, platform: 'allfantasy', platformLeagueId: null, playoffWeeksPerRound: null } as never

beforeEach(() => {
  findMany.mockResolvedValue([
    { rosterId: 'r1', playerId: 'p1', slotType: 'starter' },
    { rosterId: 'r1', playerId: 'p2', slotType: 'bench' },
    { rosterId: 'r2', playerId: 'p3', slotType: 'starter' },
    { rosterId: 'r3', playerId: 'p4', slotType: 'starter' },
    { rosterId: 'r4', playerId: 'p5', slotType: 'starter' },
  ])
  af.mockResolvedValue(new Map([['p1', 60], ['p2', 500], ['p3', 40], ['p4', 30]]))
  games.mockReturnValue([
    { id: 'g1', kind: 'regular', label: null, status: 'upcoming', mine: true,
      home: { rosterId: 'r1', teamName: 'Ghosts', totalPoints: 0 }, away: { rosterId: 'r2', teamName: 'Owls', totalPoints: 0 } },
    { id: 'g2', kind: 'regular', label: null, status: 'live', mine: false,
      home: { rosterId: 'r3', teamName: 'Mob', totalPoints: 12.5 }, away: { rosterId: 'r4', teamName: 'Tanks', totalPoints: 9 } },
  ])
})

describe('loadNativeLeagueWeekCards', () => {
  it('puts your side first, sums only starters, and gives the win chance from both projections', async () => {
    const out = await loadNativeLeagueWeekCards({ league, viewerUserId: 'me' })
    const [mine, other] = out!.cards
    expect(out!.week).toBe(7)
    expect(mine.home).toMatchObject({ rosterId: 'r2', isYou: true, projected: 40, points: null, record: null })
    // The bench player's 500 is not counted.
    expect(mine.away).toMatchObject({ rosterId: 'r1', projected: 60, record: '3-1', avatarUrl: 'https://x/a.png' })
    // Flipped with the sides: you (40) against them (60) = 40%.
    expect(mine.homeWinProbability).toBeCloseTo(0.4, 5)
    // A side with no priced starter has no projection, so that game has no win chance.
    expect(other.home).toMatchObject({ rosterId: 'r3', points: 12.5, projected: 30, record: '2-1-1' })
    expect(other.away?.projected).toBeNull()
    expect(other.homeWinProbability).toBeNull()
  })

  it('a final game has no win chance', async () => {
    games.mockReturnValue([{ id: 'g1', kind: 'regular', label: null, status: 'final', mine: false,
      home: { rosterId: 'r1', teamName: 'Ghosts', totalPoints: 100 }, away: { rosterId: 'r3', teamName: 'Mob', totalPoints: 90 } }])
    const out = await loadNativeLeagueWeekCards({ league, viewerUserId: 'me' })
    expect(out!.cards[0].homeWinProbability).toBeNull()
    expect(out!.cards[0].home.points).toBe(100)
  })
})
