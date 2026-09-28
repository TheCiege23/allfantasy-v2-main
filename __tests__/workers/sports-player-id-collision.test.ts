/**
 * A bare `NFL:<n>` id in `sports_players` is read as a Sleeper id (lib/data/players.ts). The
 * importer used to write other providers' raw ids in the same form, so Rolling Insights' id for
 * Trent McDuffie (6770) landed on Joe Burrow's Sleeper id and the Trade Center priced Burrow's
 * roster slot as a defensive back. These cases are the production collisions, by id and name.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/workers/api-chain', () => ({ apiChain: { fetch: vi.fn() } }))

import { keySeedsToSleeperIdentity } from '@/lib/workers/sports-data-importer'

const owners = [
  { sleeperId: '6770', name: 'Joe Burrow' },
  { sleeperId: '8364', name: 'Trent McDuffie' },
  { sleeperId: '9997', name: 'Zay Flowers' },
  { sleeperId: '7607', name: 'Michael Carter' },
  { sleeperId: '7835', name: 'Michael Carter' },
  { sleeperId: '8138', name: 'James Cook' },
]

const seed = (id: string, name: string, team = 'FA') => ({ id, name, team, position: 'FLEX', source: 'cache' })

describe('keySeedsToSleeperIdentity', () => {
  it('never writes another provider’s id onto a Sleeper id that belongs to somebody else', () => {
    // Rolling Insights: Trent McDuffie is 6770, Joe Burrow is 5427.
    const out = keySeedsToSleeperIdentity('NFL', [seed('NFL:6770', 'Trent McDuffie', 'LAR'), seed('NFL:5427', 'Joe Burrow', 'CIN')], owners)
    expect(out.map((s) => [s.name, s.id])).toEqual([
      ['Trent McDuffie', 'NFL:8364'],
      ['Joe Burrow', 'NFL:6770'],
    ])
  })

  it('moves a colliding row with no Sleeper identity to its name/team key', () => {
    // Dillon Bell has no Sleeper identity row here; 9997 is Zay Flowers.
    const [out] = keySeedsToSleeperIdentity('NFL', [seed('NFL:9997', 'Dillon Bell', 'HOU')], owners)
    expect(out.id).toBe('NFL:dillon-bell:HOU')
  })

  it('does not guess between two Sleeper players who share a name', () => {
    const [out] = keySeedsToSleeperIdentity('NFL', [seed('NFL:6371', 'Michael Carter', 'TEN')], owners)
    expect(out.id).toBe('NFL:6371')
  })

  it('keeps a seed already on its own Sleeper id, and matches through a generational suffix', () => {
    const out = keySeedsToSleeperIdentity('NFL', [seed('NFL:6770', 'Joe Burrow'), seed('NFL:1234', 'James Cook III')], owners)
    expect(out.map((s) => s.id)).toEqual(['NFL:6770', 'NFL:8138'])
  })

  it('leaves ids alone for a sport whose identity map carries no Sleeper ids', () => {
    const seeds = [seed('NBA:6770', 'Somebody Else')]
    expect(keySeedsToSleeperIdentity('NBA', seeds, [])).toBe(seeds)
  })

  it('leaves a non-colliding provider id alone', () => {
    const [out] = keySeedsToSleeperIdentity('NFL', [seed('NFL:99999999', 'Unknown Rookie')], owners)
    expect(out.id).toBe('NFL:99999999')
  })
})
