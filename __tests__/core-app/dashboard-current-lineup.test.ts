import { beforeEach, describe, expect, it, vi } from 'vitest'

const live = vi.hoisted(() => vi.fn())
vi.mock('@/lib/core-app/currentSleeperRoster', () => ({ currentSleeperRoster: live }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  leagueTeam: { findMany: async () => [{ leagueId: 'af-league', platformUserId: 'owner', externalId: '3', teamName: 'NFC Dreaming' }] },
  roster: { findMany: async () => [{ leagueId: 'af-league', playerData: { players: ['sampson', 'hill'], starters: ['sampson'] } }] },
  sportsGame: { findMany: async () => [] },
  sportsPlayer: { findMany: async () => [
    { sleeperId: 'sampson', name: 'Dylan Sampson', position: 'RB', team: 'CLE', sport: 'NFL', imageUrl: null },
    { sleeperId: 'hill', name: 'Justice Hill', position: 'RB', team: 'BAL', sport: 'NFL', imageUrl: null },
  ] },
  sportsInjury: { findMany: async () => [{ playerName: 'Dylan Sampson', position: 'RB', team: 'CLE', status: 'IR', description: 'Injured reserve', date: new Date('2026-09-19') }] },
  playerValueSnapshot: { findMany: async () => [] },
} }))
import { getDash34Data } from '@/lib/core-app/dash34'
import { mergeDash34Issues } from '@/lib/core-app/mergeDash34Issues'

const leagues = [{ id: 'af-league', name: 'NFC Dreaming', platform: 'sleeper', platformLeagueId: 'sleeper-league', sport: 'NFL', status: 'in_season' }]

describe('dashboard lineup alerts use current assignments', () => {
  beforeEach(() => live.mockReset())
  it('does not alert on the imported starter after Sleeper puts him on the bench', async () => {
    live.mockResolvedValue({ players: ['sampson', 'hill'], starters: ['hill'], reserve: [], taxi: [] })
    const dashboard = await getDash34Data('user', leagues, new Date('2026-09-19'))
    expect(dashboard.allLeagues?.[0].hurtStarters).toBe(0)
    expect(mergeDash34Issues([], dashboard).some((i) => i.id.endsWith(':starter-out'))).toBe(false)
  })
  it('still alerts when the live roster confirms that injured player is starting', async () => {
    live.mockResolvedValue({ players: ['sampson', 'hill'], starters: ['sampson'], reserve: [], taxi: [] })
    const dashboard = await getDash34Data('user', leagues, new Date('2026-09-19'))
    expect(dashboard.allLeagues?.[0].hurtStarters).toBe(1)
    expect(mergeDash34Issues([], dashboard).some((i) => i.id.endsWith(':starter-out'))).toBe(true)
  })
  it('does not resurrect a stale starter when live verification fails', async () => {
    live.mockResolvedValue(null)
    const dashboard = await getDash34Data('user', leagues, new Date('2026-09-19'))
    expect(mergeDash34Issues([], dashboard)).toEqual([])
    expect(dashboard.allLeagues?.[0].chips).toContainEqual({ label: 'LINEUP NOT VERIFIED', tone: 'warn' })
  })
})
