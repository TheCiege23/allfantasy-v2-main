import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ identities: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { playerIdentityMap: { findMany: h.identities } } }))

import { bridgeImportedGameLogIds } from '@/lib/redraft/importedGameLogIdBridge'

beforeEach(() => { vi.clearAllMocks(); h.identities.mockResolvedValue([]) })

describe('imported roster to game-log identity bridge', () => {
  it('uses the provider column and does not treat matching numeric ids as proof', async () => {
    h.identities.mockResolvedValue([{ id: 'canonical-1', espnId: '123', fleaflickerId: null,
      mflId: null, fantraxId: null, cfbdId: null }])
    const bridge = await bridgeImportedGameLogIds({ provider: 'espn', sport: 'NBA', rosterIds: ['123', '456'] })
    expect(h.identities.mock.calls[0][0].where).toEqual({ sport: 'NBA', espnId: { in: ['123', '456'] } })
    expect(bridge.gameLogIds).toEqual(['canonical-1'])
    expect(bridge.rosterIdFor('canonical-1')).toBe('123')
    expect(bridge.rosterIdFor('123')).toBeUndefined()
    expect(bridge.unresolved).toEqual(['456'])
  })

  it('refuses provider-id and game-log-id collisions', async () => {
    h.identities.mockResolvedValue([
      { id: 'one', fantraxId: 'fx1' }, { id: 'two', fantraxId: 'fx1' },
      { id: 'shared', fantraxId: 'fx2' }, { id: 'shared', fantraxId: 'fx3' },
    ])
    const bridge = await bridgeImportedGameLogIds({ provider: 'fantrax', sport: 'NHL',
      rosterIds: ['fx1', 'fx2', 'fx3'] })
    expect(bridge.gameLogIds).toEqual([])
    expect(bridge.ambiguous).toEqual(['fx1', 'fx2', 'fx3'])
  })

  it('requires a CFBD identity for imported college football logs', async () => {
    h.identities.mockResolvedValue([{ id: 'canonical', fantraxId: 'fx1', cfbdId: 'cfbd-22' },
      { id: 'another', fantraxId: 'fx2', cfbdId: null }])
    const bridge = await bridgeImportedGameLogIds({ provider: 'fantrax', sport: 'NCAAF',
      rosterIds: ['fx1', 'fx2'] })
    expect(bridge.gameLogIds).toEqual(['cfbd-22'])
    expect(bridge.unresolved).toEqual(['fx2'])
  })

  it('refuses providers without a verified identity column', async () => {
    const bridge = await bridgeImportedGameLogIds({ provider: 'yahoo', sport: 'NBA', rosterIds: ['55'] })
    expect(bridge.unresolved).toEqual(['55'])
    expect(h.identities).not.toHaveBeenCalled()
  })
})
