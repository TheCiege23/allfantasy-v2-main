/**
 * Devy import: a Sleeper league's rostered players are all named, not just the first 120.
 * Names come from our identity registry first (PlayerIdentityMap.sleeperId); Sleeper's player map
 * is loaded only for ids the registry doesn't know.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/sleeper-client', () => ({
  getLeagueInfo: vi.fn(), getLeagueRosters: vi.fn(), getLeagueUsers: vi.fn(), getPlayersBySport: vi.fn(),
}))

import { resolveSleeperPlayerNames } from '@/lib/devy/importEngine'

const ids = (n: number) => Array.from({ length: n }, (_, i) => String(1000 + i))

describe('resolveSleeperPlayerNames', () => {
  it('names every rostered player of a 300-player league, registry first', async () => {
    const all = ids(300)
    const findIdentities = vi.fn(async (q: string[]) => q.map((id) => ({ sleeperId: id, canonicalName: `Reg ${id}` })))
    const loadSleeperPlayers = vi.fn(async () => ({}))
    const out = await resolveSleeperPlayerNames(all, { findIdentities, loadSleeperPlayers })
    expect(Object.keys(out)).toHaveLength(300)
    expect(out['1299']).toBe('Reg 1299')
    // Every id was asked of the registry — no 120 cap.
    expect(findIdentities.mock.calls[0]![0]).toHaveLength(300)
    // Nothing missing, so Sleeper's ~5 MB player map is never fetched.
    expect(loadSleeperPlayers).not.toHaveBeenCalled()
  })

  it('falls back to Sleeper only for ids the registry does not know', async () => {
    const findIdentities = vi.fn(async () => [{ sleeperId: '1', canonicalName: 'Known One' }])
    const loadSleeperPlayers = vi.fn(async () => ({ '2': { full_name: 'Sleeper Two' }, '3': { first_name: 'Three', last_name: 'Name' } }) as never)
    const out = await resolveSleeperPlayerNames(['1', '2', '3', '4', '2'], { findIdentities, loadSleeperPlayers })
    expect(out).toEqual({ '1': 'Known One', '2': 'Sleeper Two', '3': 'Three Name', '4': 'Player 4' })
    expect(loadSleeperPlayers).toHaveBeenCalledTimes(1)
  })

  it('a failed registry read still names everyone from Sleeper', async () => {
    const out = await resolveSleeperPlayerNames(ids(130), {
      findIdentities: async () => { throw new Error('db down') },
      loadSleeperPlayers: async () => Object.fromEntries(ids(130).map((id) => [id, { full_name: `S ${id}` }])) as never,
    })
    expect(Object.keys(out)).toHaveLength(130)
    expect(out['1129']).toBe('S 1129')
  })

  it('no ids, no reads', async () => {
    const findIdentities = vi.fn(async () => [])
    const loadSleeperPlayers = vi.fn(async () => ({}))
    expect(await resolveSleeperPlayerNames([], { findIdentities, loadSleeperPlayers })).toEqual({})
    expect(findIdentities).not.toHaveBeenCalled()
    expect(loadSleeperPlayers).not.toHaveBeenCalled()
  })
})
