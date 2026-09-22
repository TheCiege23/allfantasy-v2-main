/**
 * The always-on league grounding packet, on the two facts it got wrong for every league.
 *
 *  1. MANAGERS. `loadManagers` queried `prisma.redraftMember`, which does not exist (the model
 *     is `RedraftLeagueMember`). Reading `.findMany` off `undefined` throws synchronously —
 *     before the `.catch()` chained to it can attach — so the whole function returned `[]`,
 *     which this packet defines as "loaded but empty". Chimmy was told every league in
 *     production had no managers.
 *  2. THE VIEWER'S ROSTER. It accepted `playerData` only when it was an ARRAY. Production
 *     stores an object (`{ players, starters, lineup_sections, … }`) of bare ids, for native
 *     and imported leagues alike, so every roster came back empty.
 *
 * Both failures looked like "this league has nothing in it", which is why they survived: an
 * empty answer is indistinguishable from a quiet league unless something asserts the shape.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/fantasy-data/fantasyDataEvidence', () => ({
  loadFantasyDataEvidence: vi.fn(async () => null),
}))
vi.mock('@/lib/fantasy-data/providerHealth', () => ({
  loadFantasyProviderHealth: vi.fn(async () => null),
}))
vi.mock('@/lib/injuries/injuryReadPort', () => ({
  listInjuryFacts: vi.fn(async () => []),
}))

const prismaMock = vi.hoisted(() => ({ current: {} as Record<string, any> }))
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    {
      get: (_t, prop: string) => prismaMock.current[prop],
    },
  ),
}))

const LEAGUE_ID = 'league-1'
const USER_ID = 'user-1'

/**
 * The production roster shape: an OBJECT of bare ids, with `lineup_sections` repeating the
 * starters. Includes the draft pool's synthetic `name:<Name>:<POS>:<TEAM>` id and an id no
 * player table can resolve.
 */
const PLAYER_DATA = {
  players: ['4034', '6794', 'name:Baltimore Defense:DEF:BAL', '99999'],
  starters: ['4034', 'name:Baltimore Defense:DEF:BAL'],
  lineup_sections: {
    starters: ['4034', 'name:Baltimore Defense:DEF:BAL'],
    bench: ['6794', '99999'],
  },
}

function basePrisma(overrides: Record<string, any> = {}) {
  const sportsPlayerCalls: any[] = []
  const prisma: Record<string, any> = {
    league: {
      findUnique: vi.fn(async () => ({
        id: LEAGUE_ID,
        name: 'Test League',
        sport: 'NFL',
        season: 2026,
        leagueType: 'redraft',
        leagueSize: 12,
        settings: {},
        status: 'in_season',
      })),
    },
    leagueTeam: {
      findMany: vi.fn(async () => [
        {
          id: 'team-1',
          teamName: 'Commish FC',
          claimedByUserId: USER_ID,
          pointsFor: 101.5,
          wins: 2,
          losses: 0,
          currentRank: 1,
          isCommissioner: false,
          isCoCommissioner: false,
          role: null,
        },
        {
          id: 'team-2',
          teamName: 'Open Slot FC',
          claimedByUserId: null,
          pointsFor: null,
          wins: null,
          losses: null,
          currentRank: null,
          isCommissioner: false,
          isCoCommissioner: false,
          role: null,
        },
      ]),
      findFirst: vi.fn(async () => ({
        teamName: 'Commish FC',
        externalId: 'roster-1',
        platformUserId: USER_ID,
      })),
    },
    redraftLeagueMember: {
      findMany: vi.fn(async () => [{ userId: USER_ID, role: 'COMMISSIONER' }]),
    },
    appUser: {
      findMany: vi.fn(async () => [
        { id: USER_ID, displayName: 'Casey', username: 'casey22' },
      ]),
    },
    roster: {
      findFirst: vi.fn(async () => ({ playerData: PLAYER_DATA, settings: {} })),
    },
    sportsPlayer: {
      findMany: vi.fn(async (args: any) => {
        sportsPlayerCalls.push(args)
        return [
          { name: 'Patrick Mahomes', position: 'QB', team: 'KC', sleeperId: '4034', externalId: null },
          { name: 'Justin Jefferson', position: 'WR', team: 'MIN', sleeperId: '6794', externalId: null },
        ]
      }),
    },
    ...overrides,
  }
  return { prisma, sportsPlayerCalls }
}

async function buildPacket(prisma: Record<string, any>) {
  prismaMock.current = prisma
  const { buildLeagueSportsGroundingPacket } = await import('@/lib/ai/leagueSportsGroundingPacket')
  return buildLeagueSportsGroundingPacket({ leagueId: LEAGUE_ID, userId: USER_ID })
}

describe('league grounding packet — managers', () => {
  it('loads managers from RedraftLeagueMember, with names and the upper-case role', async () => {
    const { prisma } = basePrisma()
    const packet = await buildPacket(prisma)

    expect(packet.managers).not.toBeNull()
    expect(packet.managers).toHaveLength(2)

    const claimed = packet.managers!.find((m) => m.userId === USER_ID)
    expect(claimed).toMatchObject({
      displayName: 'Casey',
      teamName: 'Commish FC',
      isCommissioner: true,
      isOpen: false,
    })

    const open = packet.managers!.find((m) => m.isOpen)
    expect(open?.displayName).toBe('Open slot')

    expect(packet.unavailable).not.toContain('league managers (no teams found)')
    expect(packet.leagueContext.isCommissioner).toBe(true)
    expect(packet.leagueContext.openSlots).toBe(1)
  })

  it('says managers could not be LOADED rather than that the league is empty', async () => {
    // leagueTeam missing entirely: the read fails, which is a different fact from "no teams".
    const { prisma } = basePrisma({ leagueTeam: undefined })
    const packet = await buildPacket(prisma)

    expect(packet.managers).toBeNull()
    expect(packet.unavailable).toContain('league managers (could not be loaded)')
    expect(packet.unavailable).not.toContain('league managers (no teams found)')
  })
})

describe('league grounding packet — viewer roster', () => {
  it('reads the object-shaped playerData and names the ids', async () => {
    const { prisma, sportsPlayerCalls } = basePrisma()
    const packet = await buildPacket(prisma)

    expect(packet.rosters).not.toBeNull()
    const roster = packet.rosters![0]
    expect(roster.teamName).toBe('Commish FC')

    const starterNames = roster.starters.map((p) => p.playerName).sort()
    expect(starterNames).toEqual(['Baltimore Defense', 'Patrick Mahomes'])

    const benchNames = roster.bench.map((p) => p.playerName).sort()
    expect(benchNames).toEqual(['Justin Jefferson', 'Unidentified player (99999)'])

    // Every rostered id is accounted for — the whole point is that none go missing.
    expect([...roster.starters, ...roster.bench]).toHaveLength(4)

    // The synthetic draft-pool id carries its own name, position and team; no lookup needed.
    const defense = roster.starters.find((p) => p.playerId.startsWith('name:'))
    expect(defense).toMatchObject({ playerName: 'Baltimore Defense', position: 'DEF', team: 'BAL' })

    // Only the ids that actually need a name are looked up, and by both id spellings.
    const where = sportsPlayerCalls[0]?.where
    expect(where.OR[0].sleeperId.in.sort()).toEqual(['4034', '6794', '99999'])
    expect(where.OR[1].externalId.in.sort()).toEqual(['4034', '6794', '99999'])
  })

  it('still reads the legacy array-of-objects shape', async () => {
    const { prisma } = basePrisma({
      roster: {
        findFirst: vi.fn(async () => ({
          playerData: [
            { playerId: '1', name: 'Legacy Starter', position: 'RB', team: 'SF', isStarter: true },
            { playerId: '2', name: 'Legacy Bench', position: 'TE', team: 'DAL' },
          ],
          settings: {},
        })),
      },
    })
    const packet = await buildPacket(prisma)

    const roster = packet.rosters![0]
    expect(roster.starters.map((p) => p.playerName)).toEqual(['Legacy Starter'])
    expect(roster.bench.map((p) => p.playerName)).toEqual(['Legacy Bench'])
  })

  it('an unreadable roster stays null, never an empty team', async () => {
    const { prisma } = basePrisma({ roster: undefined })
    const packet = await buildPacket(prisma)
    expect(packet.rosters).toBeNull()
  })
})
