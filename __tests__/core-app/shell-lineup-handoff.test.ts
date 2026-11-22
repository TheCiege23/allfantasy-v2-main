// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Updates menu's "Fix lineup in <platform>" destination (lib/core-app/shellLineupHandoff.ts).
 * Sleeper lands on its verified lineup screen; Fantrax needs its own league id looked up, because
 * `League.platformLeagueId` holds a local uuid there; anything unbuildable is null, never a homepage.
 */

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => ({
  team: vi.fn(),
  fantrax: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findFirst: db.team },
    fantraxLeague: { findMany: db.fantrax },
  },
}))

import { shellLineupHandoff } from '@/lib/core-app/shellLineupHandoff'

const LOCAL_UUID = '3f2b8c1e-9a4d-4e6b-8c2a-1d5e7f9a0b3c'

beforeEach(() => {
  db.team.mockReset().mockResolvedValue({ externalId: '7' })
  db.fantrax.mockReset().mockResolvedValue([])
})

describe('shellLineupHandoff', () => {
  it('Sleeper: the verified lineup screen', async () => {
    const link = await shellLineupHandoff('u1', { id: 'L1', platform: 'sleeper', platformLeagueId: '1313566817444167680', name: 'KB NFL' })
    expect(link?.href).toBe('https://sleeper.com/leagues/1313566817444167680/team')
    expect(link?.screen).toBe('Lineup')
    expect(link?.platformLabel).toBe('Sleeper')
    // Only the viewer's own team is read.
    expect(db.team).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'L1', claimedByUserId: 'u1' } }))
  })

  it('ESPN: the team id from the viewer\'s claimed team goes into the URL', async () => {
    const link = await shellLineupHandoff('u1', { id: 'L2', platform: 'espn', platformLeagueId: '919055222', season: 2026, name: 'E' })
    expect(link?.screen).toBe('Lineup')
    expect(link?.href).toContain('leagueId=919055222')
    expect(link?.href).toContain('teamId=7')
  })

  it('Fantrax: looks up Fantrax\'s own id and opens the league page (lineup not yet verified)', async () => {
    db.fantrax.mockResolvedValue([{ id: LOCAL_UUID, sourceLeagueId: 'v2kzedypmm8jp61b' }])
    const link = await shellLineupHandoff('u1', { id: 'L3', platform: 'fantrax', platformLeagueId: LOCAL_UUID, name: 'F' })
    expect(db.fantrax).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [LOCAL_UUID] } } }))
    // Parsed rather than spelled out: the DB-first guard reads a literal provider URL as a feed call.
    expect(new URL(link!.href).hostname).toBe('www.fantrax.com')
    expect(new URL(link!.href).pathname).toBe('/fantasy/league/v2kzedypmm8jp61b/home')
    expect(link?.screen).toBe('League')
  })

  it('Fantrax imported before the id was recorded: no button, not the homepage', async () => {
    db.fantrax.mockResolvedValue([{ id: LOCAL_UUID, sourceLeagueId: null }])
    expect(await shellLineupHandoff('u1', { id: 'L4', platform: 'fantrax', platformLeagueId: LOCAL_UUID, name: 'F' })).toBeNull()
  })

  it('native leagues get nothing, and a failed read is no button rather than a thrown error', async () => {
    expect(await shellLineupHandoff('u1', { id: 'L5', platform: 'allfantasy', platformLeagueId: null, name: 'N' })).toBeNull()
    db.fantrax.mockRejectedValue(new Error('db down'))
    expect(await shellLineupHandoff('u1', { id: 'L6', platform: 'fantrax', platformLeagueId: LOCAL_UUID, name: 'F' })).toBeNull()
  })
})
