import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ shared: vi.fn(), fantrax: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/core-app/rosterIdCrosswalk', () => ({ crosswalkToSleeperIds: h.shared }))
vi.mock('@/lib/player-identity/resolveRosterPlayerIdentities', () => ({
  normalizeIdentitySport: (sport: string) => (String(sport ?? '').trim() ? String(sport).toUpperCase() : 'NFL'),
  resolveFantraxIdentities: h.fantrax,
}))

import { lineupCrosswalkToSleeperIds, lineupRegistryNames } from '@/lib/core-app/lineupCrosswalk'

/**
 * Production 2026-11-20: a Fantrax matchup said "None of the 18 players in this lineup could be identified — we
 * hold no id bridge for fantrax". The registry held the bridge; the matchup board's crosswalk had no Fantrax entry.
 */
describe('lineupCrosswalkToSleeperIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.shared.mockResolvedValue(new Map([['espn-1', 'sleeper-9']]))
  })

  it('translates a Fantrax NFL id through the identity registry, dropping one with no Sleeper id', async () => {
    h.fantrax.mockResolvedValue(new Map([
      ['04abc', { name: 'Linked Back', sleeperId: '4034' }],
      ['05rlf', { name: 'Rookie Back', sleeperId: null }],
    ]))
    const out = await lineupCrosswalkToSleeperIds('Fantrax', 'nfl', ['04abc', '05rlf', '06zzz'])
    expect(h.fantrax).toHaveBeenCalledWith('NFL', ['04abc', '05rlf', '06zzz'])
    expect([...out]).toEqual([['04abc', '4034']])
    expect(h.shared).not.toHaveBeenCalled()
  })

  it('leaves every other platform, and Fantrax outside the NFL, on the shared crosswalk', async () => {
    expect([...(await lineupCrosswalkToSleeperIds('espn', 'NFL', ['espn-1']))]).toEqual([['espn-1', 'sleeper-9']])
    await lineupCrosswalkToSleeperIds('fantrax', 'NCAAF', ['x'])
    expect(h.shared).toHaveBeenNthCalledWith(1, 'espn', 'NFL', ['espn-1'])
    expect(h.shared).toHaveBeenNthCalledWith(2, 'fantrax', 'NCAAF', ['x'])
    expect(h.fantrax).not.toHaveBeenCalled()
  })
})

/** Production 2026-11-20: after the bridge, "2 of 18 players in this lineup could not be identified" - named in the registry, with no Sleeper id. */
describe('lineupRegistryNames', () => {
  beforeEach(() => vi.clearAllMocks())

  it('names a Fantrax NFL starter from the registry, and only one the registry names', async () => {
    h.fantrax.mockResolvedValue(new Map([
      ['05rlf', { name: 'Rookie Back', position: 'RB', team: 'LV', sleeperId: null }],
      ['06zzz', { name: null, position: 'WR', team: 'KC', sleeperId: null }],
    ]))
    const out = await lineupRegistryNames('fantrax', 'NFL', ['05rlf', '06zzz'])
    expect([...out]).toEqual([['05rlf', { name: 'Rookie Back', position: 'RB', team: 'LV' }]])
  })

  it('reads nothing for another platform, another sport, or no ids', async () => {
    expect((await lineupRegistryNames('espn', 'NFL', ['1'])).size).toBe(0)
    expect((await lineupRegistryNames('fantrax', 'NCAAF', ['1'])).size).toBe(0)
    expect((await lineupRegistryNames('fantrax', 'NFL', [])).size).toBe(0)
    expect(h.fantrax).not.toHaveBeenCalled()
  })
})
