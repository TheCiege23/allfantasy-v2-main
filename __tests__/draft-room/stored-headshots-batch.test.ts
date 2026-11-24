import { describe, expect, it, vi } from 'vitest'

/**
 * Photos for a hosted non-NFL league's players, many at once (lib/draft-room/storedPickHeadshot.ts).
 * Their ids are Rolling Insights ids; Tari Eason is RI 1479, the same number as Sleeper's Doron Lamb
 * and Keenan Allen.
 */
const rows = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsPlayer: { findMany: vi.fn(async () => rows.list) } } }))

import { resolveStoredHeadshotsBatch } from '@/lib/draft-room/storedPickHeadshot'

const EASON = 'https://r2.thesportsdb.com/images/media/player/cutout/ffd7hc1703672767.png'

describe('resolveStoredHeadshotsBatch', () => {
  it('takes the Rolling Insights row whose id and name are the player’s', async () => {
    rows.list = [
      { externalId: '1479', source: 'rolling_insights', name: 'Tari Eason', team: 'Houston Rockets', imageUrl: EASON },
      { externalId: 'sleeper:1479', source: 'sleeper', name: 'Doron Lamb', team: null, imageUrl: 'https://sleepercdn.com/content/nba/players/thumb/1479.jpg' },
    ]
    const out = await resolveStoredHeadshotsBatch('NBA', [{ playerId: '1479', playerName: 'Tari Eason', team: 'Houston Rockets' }])
    expect(out.get('1479')).toBe(EASON)
  })

  it('never puts a different man’s face on an id that matches but a name that does not', async () => {
    rows.list = [{ externalId: '1479', source: 'rolling_insights', name: 'Someone Else', team: null, imageUrl: 'https://img/else.png' }]
    const out = await resolveStoredHeadshotsBatch('NBA', [{ playerId: '1479', playerName: 'Tari Eason' }])
    expect(out.has('1479')).toBe(false)
  })

  it('[control] the NFL is left to its Sleeper photos', async () => {
    rows.list = [{ externalId: '1479', source: 'rolling_insights', name: 'Tari Eason', team: null, imageUrl: EASON }]
    expect((await resolveStoredHeadshotsBatch('NFL', [{ playerId: '1479', playerName: 'Tari Eason' }])).size).toBe(0)
  })
})
