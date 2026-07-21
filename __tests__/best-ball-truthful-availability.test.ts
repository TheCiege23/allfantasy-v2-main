import { beforeEach, describe, expect, it, vi } from 'vitest'

// Best-ball must distinguish "stat row with 0 points" (real zero) from "no stat row"
// (missing data). PlayerGameStat sat at ZERO production rows while the engine valued every
// player at 0.0 via `?? 0` and emitted success-shaped notes ("maximized projected points to
// 0.0") around an arbitrary lineup.

const findManyPlayerGameStat = vi.fn()
const findManySportsPlayer = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerGameStat: { findMany: (...args: unknown[]) => findManyPlayerGameStat(...args) },
    sportsPlayer: { findMany: (...args: unknown[]) => findManySportsPlayer(...args) },
  },
}))

vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({
  getRosterTemplateForLeague: vi.fn(async () => ({
    slots: [
      { slotName: 'QB', starterCount: 1, allowedPositions: ['QB'] },
      { slotName: 'RB', starterCount: 1, allowedPositions: ['RB'] },
    ],
  })),
}))

import { selectBestBallLineupForRoster } from '@/lib/scoring/best-ball-engine'

const BASE_INPUT = {
  leagueId: 'league-1',
  leagueSport: 'NFL' as never,
  season: 2025,
  weekOrRound: 3,
  rosterPlayerIds: ['1001', '1002'],
}

const PLAYERS = [
  { externalId: '1001', sleeperId: '1001', name: 'QB One', position: 'QB', team: 'KC' },
  { externalId: '1002', sleeperId: '1002', name: 'RB One', position: 'RB', team: 'SF' },
]

beforeEach(() => {
  findManyPlayerGameStat.mockReset()
  findManySportsPlayer.mockReset()
  findManySportsPlayer.mockResolvedValue(PLAYERS)
})

describe('selectBestBallLineupForRoster — truthful availability', () => {
  it('returns UNAVAILABLE with empty starters and null points when no stats exist', async () => {
    findManyPlayerGameStat.mockResolvedValue([])
    const result = await selectBestBallLineupForRoster(BASE_INPUT)

    expect(result.status).toBe('UNAVAILABLE')
    expect(result.starterIds).toEqual([])
    expect(result.totalProjectedPoints).toBeNull()
    expect(result.missingPlayerIds).toEqual(['1001', '1002'])
    // No success-shaped copy around missing data.
    expect(result.notes.join(' ')).not.toMatch(/maximized/i)
    expect(result.notes.join(' ')).toMatch(/unavailable/i)
  })

  it('optimizes normally when every player has stats — a real 0.0 stays a numeric zero', async () => {
    findManyPlayerGameStat.mockResolvedValue([
      { playerId: '1001', fantasyPoints: 18.4 },
      { playerId: '1002', fantasyPoints: 0 }, // played, scored zero — legitimate data
    ])
    const result = await selectBestBallLineupForRoster(BASE_INPUT)

    expect(result.status).toBe('AVAILABLE')
    expect(result.missingPlayerIds).toEqual([])
    expect(result.starterIds).toContain('1001')
    expect(result.starterIds).toContain('1002')
    expect(result.totalProjectedPoints).toBeCloseTo(18.4)
  })

  it('returns PARTIAL and excludes missing players instead of valuing them 0.0', async () => {
    findManyPlayerGameStat.mockResolvedValue([
      { playerId: '1001', fantasyPoints: 21.0 },
      // 1002 has NO row — with a bench QB alternative present the lineup stays fillable
    ])
    const input = { ...BASE_INPUT, rosterPlayerIds: ['1001', '1002', '1003'] }
    findManySportsPlayer.mockResolvedValue([
      ...PLAYERS,
      { externalId: '1003', sleeperId: '1003', name: 'RB Two', position: 'RB', team: 'DAL' },
    ])
    findManyPlayerGameStat.mockResolvedValue([
      { playerId: '1001', fantasyPoints: 21.0 },
      { playerId: '1003', fantasyPoints: 7.5 },
    ])

    const result = await selectBestBallLineupForRoster(input)
    expect(result.status).toBe('PARTIAL')
    expect(result.missingPlayerIds).toEqual(['1002'])
    expect(result.starterIds).not.toContain('1002')
    expect(result.notes.join(' ')).toMatch(/missing/i)
  })

  it('refuses to fabricate a lineup when missing stats leave required slots unfillable', async () => {
    // Only the QB has stats; the RB slot cannot be filled from players with real data.
    findManyPlayerGameStat.mockResolvedValue([{ playerId: '1001', fantasyPoints: 12.2 }])
    const result = await selectBestBallLineupForRoster(BASE_INPUT)

    expect(result.status).toBe('UNAVAILABLE')
    expect(result.starterIds).toEqual([])
    expect(result.totalProjectedPoints).toBeNull()
  })
})
