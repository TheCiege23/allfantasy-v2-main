// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

/*
 * A native Zombie league's standings read W-L/PF off ZombieLeagueTeam, which only the legacy import path
 * writes — 0-0 all season. Records now come from the season rosters, mapped exactly like the week results.
 */

const db = vi.hoisted(() => ({
  redraftSeason: { findFirst: vi.fn() },
  redraftRoster: { findMany: vi.fn() },
  roster: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { loadNativeSeasonRecords, seasonRosterToLeagueRoster } from '@/lib/zombie/ZombieInfectionEngine'

describe('seasonRosterToLeagueRoster', () => {
  const toRoster = seasonRosterToLeagueRoster(
    [
      { id: 'rr-linked', ownerId: 'u-1' },
      { id: 'rr-owner', ownerId: 'u-2' },
      { id: 'rr-open', ownerId: 'roster:R-open' },
      { id: 'rr-gone', ownerId: 'u-gone' },
    ],
    [
      { id: 'R-1', platformUserId: 'u-1', redraftRosterId: 'rr-linked' },
      { id: 'R-2', platformUserId: 'u-2', redraftRosterId: null },
      { id: 'R-open', platformUserId: 'open-slot-L-3', redraftRosterId: null },
    ],
  )
  it('uses the stored link, then the manager, then the open-seat id', () => {
    expect(toRoster('rr-linked')).toBe('R-1')
    expect(toRoster('rr-owner')).toBe('R-2')
    expect(toRoster('rr-open')).toBe('R-open')
    expect(toRoster('rr-gone')).toBeNull()
  })
})

describe('loadNativeSeasonRecords', () => {
  it("returns each league roster's record from its season roster", async () => {
    db.redraftSeason.findFirst.mockResolvedValue({ id: 's1' })
    db.redraftRoster.findMany.mockResolvedValue([
      { id: 'rr-1', ownerId: 'u-1', wins: 3, losses: 1, ties: 0, pointsFor: 4120.5 },
      { id: 'rr-open', ownerId: 'roster:R-open', wins: 1, losses: 3, ties: 0, pointsFor: 3600 },
    ])
    db.roster.findMany.mockResolvedValue([
      { id: 'R-1', platformUserId: 'u-1', redraftRosterId: null },
      { id: 'R-open', platformUserId: 'open-slot-L-2', redraftRosterId: null },
    ])
    const records = await loadNativeSeasonRecords('L1', 2026)
    expect(Object.fromEntries(records!)).toEqual({
      'R-1': { wins: 3, losses: 1, ties: 0, pointsFor: 4120.5 },
      'R-open': { wins: 1, losses: 3, ties: 0, pointsFor: 3600 },
    })
  })

  it('is null for a league with no season (an imported league keeps its own rows)', async () => {
    db.redraftSeason.findFirst.mockResolvedValue(null)
    expect(await loadNativeSeasonRecords('L1', 2026)).toBeNull()
  })
})
