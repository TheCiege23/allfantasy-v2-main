/**
 * `chooseBestSportsPlayer` ranked `rolling_insights` above `sleeper` and rewarded having a team,
 * so a Sleeper free agent came back on his LAST club (Tyreek Hill → MIA, with Miami's bye and
 * opponent on the redraft roster), and a TheSportsDB namesake stamped with the same Sleeper id
 * could outrank the real row (Byron Murphy, CB MIN, as the Seahawks' DT). Production row shapes,
 * measured 2026-10-12. See lib/player-match/authoritativePlayerRow.ts for the rule.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { getCanonicalNflPlayerContext } from '@/lib/nfl-data-foundation/nflDataFoundationService'

type Row = Record<string, unknown>

const T0 = new Date('2026-10-12T00:00:00.000Z')
const T1 = new Date('2026-10-12T06:00:00.000Z')

function sportsRow(overrides: Row): Row {
  return {
    id: `sp-${String(overrides.source)}-${String(overrides.sleeperId)}`,
    sport: 'NFL',
    externalId: String(overrides.sleeperId),
    name: 'Someone',
    position: null,
    team: null,
    teamId: null,
    number: null,
    imageUrl: null,
    sleeperId: null,
    status: null,
    source: 'sleeper',
    fetchedAt: T0,
    expiresAt: T1,
    updatedAt: T0,
    ...overrides,
  }
}

/** Every delegate but the two identity reads answers empty. */
function fakeDb(rows: Row[], identity: Row | null) {
  const empty = new Proxy(
    {},
    {
      get: (_t, method: string) => async () =>
        String(method).startsWith('findMany') ? [] : String(method) === 'count' ? 0 : null,
    },
  )
  return new Proxy(
    {
      sportsPlayer: { findMany: async () => rows, findFirst: async () => null },
      playerIdentityMap: { findFirst: async () => identity, findMany: async () => [] },
    } as Row,
    { get: (t, key: string) => (key in t ? t[key] : empty) },
  ) as never
}

const opts = (rows: Row[], identity: Row | null = null) => ({ season: 2026, week: 6, prismaClient: fakeDb(rows, identity) })

describe('canonical NFL player — the Sleeper row decides who the player is', () => {
  it('a Sleeper free agent stays a free agent, whatever club the vendor row remembers', async () => {
    const rows = [
      sportsRow({ source: 'rolling_insights', sleeperId: '3321', externalId: '7781', name: 'Tyreek Hill', position: 'WR', team: 'MIA', teamId: 'MIA', imageUrl: 'https://ri.example/hill.png', fetchedAt: T1 }),
      sportsRow({ source: 'sleeper', sleeperId: '3321', name: 'Tyreek Hill', position: 'WR', team: null, imageUrl: 'https://sleepercdn.com/content/nfl/players/thumb/3321.jpg' }),
    ]
    const player = await getCanonicalNflPlayerContext('3321', opts(rows))
    expect(player?.team).toBeNull()
    expect(player?.teamId).toBeNull()
    expect(player?.position).toBe('WR')
    // Stats stay keyed on the agreeing Rolling Insights row — that is how season stats are stored.
    expect(player?.providerIds.rollingInsightsId).toBe('7781')
  })

  it('a namesake from another feed neither renames nor repositions him, nor lends its ids', async () => {
    const rows = [
      sportsRow({ source: 'thesportsdb', sleeperId: '5864', externalId: 'tsdb_1', name: 'Byron Murphy', position: 'DT', team: 'SEA', imageUrl: 'https://img.example/tsdb/murphy-dt.png', fetchedAt: T1 }),
      sportsRow({ source: 'rolling_insights', sleeperId: '5864', externalId: '9001', name: 'Byron Murphy', position: 'DT', team: 'SEA', fetchedAt: T1 }),
      sportsRow({ source: 'sleeper', sleeperId: '5864', name: 'Byron Murphy', position: 'CB', team: 'MIN', imageUrl: 'https://sleepercdn.com/content/nfl/players/thumb/5864.jpg' }),
    ]
    const player = await getCanonicalNflPlayerContext('5864', opts(rows))
    expect(player?.position).toBe('CB')
    expect(player?.team).toBe('MIN')
    expect(player?.headshotUrl).toBe('https://sleepercdn.com/content/nfl/players/thumb/5864.jpg')
    expect(player?.providerIds.rollingInsightsId).toBeNull()
    expect(player?.playerId).toBe('sp-sleeper-5864')
  })

  it('control: with no Sleeper row the vendor ranking still decides', async () => {
    const rows = [sportsRow({ source: 'rolling_insights', sleeperId: '42', externalId: '4242', name: 'Vendor Only', position: 'RB', team: 'KC' })]
    const player = await getCanonicalNflPlayerContext('42', opts(rows))
    expect(player?.team).toBe('KC')
    expect(player?.providerIds.rollingInsightsId).toBe('4242')
  })
})
