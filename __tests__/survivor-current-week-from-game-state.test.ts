/**
 * The survivor week is the game's own week first. The resolver guessed it from settings, team
 * performance, matchup facts and the draft, none of which a native survivor league has, so it
 * answered 1 while the game state said 6.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  survivorGameState: { findUnique: vi.fn() },
  league: { findUnique: vi.fn() },
  leagueTeam: { findMany: vi.fn(async () => []) },
  teamPerformance: { findFirst: vi.fn(async () => null) },
  matchupFact: { findFirst: vi.fn(async () => null) },
  draftSession: { findFirst: vi.fn(async () => null) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { resolveSurvivorCurrentWeek } from '@/lib/survivor/SurvivorTimelineResolver'

beforeEach(() => {
  vi.clearAllMocks()
  db.league.findUnique.mockResolvedValue({ season: 2026, settings: {} })
})

describe('resolveSurvivorCurrentWeek', () => {
  it('an explicit week still wins', async () => {
    db.survivorGameState.findUnique.mockResolvedValue({ currentWeek: 6 })
    expect(await resolveSurvivorCurrentWeek('L', 3)).toBe(3)
    expect(db.survivorGameState.findUnique).not.toHaveBeenCalled()
  })

  it('the game state\'s week is used before any guess', async () => {
    db.survivorGameState.findUnique.mockResolvedValue({ currentWeek: 6 })
    expect(await resolveSurvivorCurrentWeek('L', null)).toBe(6)
    expect(db.league.findUnique).not.toHaveBeenCalled()
  })

  it('no game state, a week of 0, or an unreadable one falls through to the older lookups', async () => {
    db.survivorGameState.findUnique.mockResolvedValueOnce(null)
    const none = await resolveSurvivorCurrentWeek('L', null)
    db.survivorGameState.findUnique.mockResolvedValueOnce({ currentWeek: 0 })
    const zero = await resolveSurvivorCurrentWeek('L', null)
    db.survivorGameState.findUnique.mockRejectedValueOnce(new Error('down'))
    const broken = await resolveSurvivorCurrentWeek('L', null)
    expect([none, zero, broken]).toEqual([none, none, none])
    expect(db.league.findUnique).toHaveBeenCalledTimes(3)
  })
})
