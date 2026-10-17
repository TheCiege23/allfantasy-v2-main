/**
 * `resolveAiTeamContext` — the roster every Chimmy "my team" tool grounds on — for a league whose
 * roster ids are not Sleeper ids.
 *
 * A Fleaflicker roster id is a short number in Sleeper's range: '6038' on a Fleaflicker roster is
 * NOT Sleeper's '6038'. `resolveNames` looks ids up in the Sleeper space, so a foreign id named a
 * real stranger, with his injury, as the user's starter.
 *
 * 🛑 AND THE FIRST FIX OVERCORRECTED: such a roster contributed NO players ("player list
 * unavailable"), and ESPN silently lost every id the map could not place (2026-10-11: 246 of 1,477).
 * Now a translatable id becomes its Sleeper id, the rest are named from the platform's own ids under
 * a prefixed id, and what could not be done is said with counts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const state = vi.hoisted(() => ({
  platform: 'sleeper',
  sport: 'NFL',
  playerData: { players: ['6038'], starters: ['6038'] } as Record<string, unknown>,
  /** PlayerIdentityMap rows the Fleaflicker/MFL bridge reads. */
  bridgeRows: [] as Array<Record<string, string | null>>,
  /** ESPN id → Sleeper id. */
  espnMap: new Map<string, string>(),
  /** Raw provider id → name, as resolveRosterPlayerIdentities would answer. */
  providerNames: new Map<string, { name: string; position: string | null; team: string | null }>(),
}))

vi.mock('@/lib/leagues/rosterForTeam', () => ({
  findRosterForTeam: vi.fn(async () => ({ playerData: state.playerData })),
}))

vi.mock('@/lib/core-app/rosterIdSpace', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/core-app/rosterIdSpace')>()
  return {
    ...real,
    loadEspnToSleeperMap: async (ids: readonly string[]) =>
      new Map(ids.filter((id) => state.espnMap.has(id)).map((id) => [id, state.espnMap.get(id)!] as [string, string])),
  }
})

vi.mock('@/lib/player-identity/resolveRosterPlayerIdentities', () => ({
  resolveRosterPlayerIdentities: async (_platform: string, _sport: string, ids: readonly string[]) =>
    new Map(
      ids
        .filter((id) => state.providerNames.has(id))
        .map((id) => [id, { ...state.providerNames.get(id)!, imageUrl: null, rollingInsightsId: null, cfbdId: null }]),
    ),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: {
      findFirst: vi.fn(async () => ({
        id: 'team-1',
        teamName: 'My Team',
        platformUserId: 'mgr-1',
        wins: 1,
        losses: 0,
        ties: 0,
        pointsFor: 100,
        currentRank: 1,
        league: { platform: state.platform },
      })),
    },
    roster: {
      findFirst: vi.fn(async () => null),
      // The bridge reads every roster in the league.
      findMany: vi.fn(async () => [{ leagueId: 'lg-1', playerData: state.playerData }]),
    },
    playerIdentityMap: { findMany: vi.fn(async () => state.bridgeRows) },
    teamPerformance: { findUnique: vi.fn(async () => null) },
    sportsPlayerRecord: { findMany: vi.fn(async () => []) },
    // The fake Sleeper player table: '6038' IS a real Sleeper id, and it is somebody else.
    // '9999' is the Sleeper id the Fleaflicker bridge maps the user's player to.
    sportsPlayer: {
      findMany: vi.fn(async (args: any) => {
        const where = JSON.stringify(args?.where ?? {})
        const rows = []
        if (where.includes('"6038"')) rows.push({ externalId: 'x', sleeperId: '6038', name: 'Wrong Player', position: 'RB', team: 'KC', status: 'Out' })
        if (where.includes('"9999"')) rows.push({ externalId: 'y', sleeperId: '9999', name: 'Right Player', position: 'WR', team: 'DET', status: 'Questionable' })
        return rows
      }),
    },
  },
}))

import { resolveAiTeamContext } from '@/lib/ai-payload/resolveAiTeamContext'

async function contextFor(platform: string) {
  state.platform = platform
  const ctx = await resolveAiTeamContext({ userId: 'u-1', leagueId: 'lg-1', sport: state.sport, season: 2026, currentPeriod: 3 })
  if (!ctx) throw new Error('no context')
  return ctx
}

beforeEach(() => {
  state.sport = 'NFL'
  state.playerData = { players: ['6038'], starters: ['6038'] }
  state.bridgeRows = []
  state.espnMap = new Map()
  state.providerNames = new Map()
})

describe('resolveAiTeamContext — foreign roster ids', () => {
  it('does not name the Sleeper player who shares a Fleaflicker roster id', async () => {
    const ctx = await contextFor('fleaflicker')
    expect(JSON.stringify(ctx)).not.toContain('Wrong Player')
    // Said, not silently empty — and with a count.
    expect(ctx.dataGaps.join(' ')).toContain('1 of 1 players on this Fleaflicker roster could not be identified')
    // The unresolved id is never handed on as a Sleeper id.
    expect(ctx.starters[0]!.playerId).toBe('fleaflicker:6038')
  })

  it('a Fleaflicker id the bridge maps becomes THAT Sleeper player, with his injury status', async () => {
    state.bridgeRows = [{ fleaflickerId: '6038', sleeperId: '9999' }]
    const ctx = await contextFor('fleaflicker')
    expect(ctx.starters).toEqual([{ playerId: '9999', name: 'Right Player', position: 'WR', team: 'DET', injuryStatus: 'Questionable' }])
    expect(JSON.stringify(ctx)).not.toContain('Wrong Player')
    expect(ctx.dataGaps).toEqual([])
  })

  it('an MFL id with no bridge is named from MFL’s own ids — never a guessed Sleeper identity', async () => {
    state.providerNames = new Map([['6038', { name: 'Named From MFL', position: 'TE', team: 'BUF' }]])
    const ctx = await contextFor('mfl')
    expect(ctx.starters[0]).toEqual({ playerId: 'mfl:6038', name: 'Named From MFL', position: 'TE', team: 'BUF', injuryStatus: null })
    expect(ctx.dataGaps.join(' ')).toContain("1 of 1 players are named from MFL's own player ids")
  })

  it('a Fantrax college roster is read from the registry (it used to contribute no players at all)', async () => {
    state.sport = 'NCAAF'
    state.playerData = { players: ['06k5m', '07abc'], starters: ['06k5m'] }
    state.providerNames = new Map([
      ['06k5m', { name: 'Arch Manning', position: 'QB', team: 'Texas' }],
      ['07abc', { name: 'Jeremiah Smith', position: 'WR', team: 'Ohio State' }],
    ])
    const ctx = await contextFor('fantrax')
    expect(ctx.starters.map((p) => p.name)).toEqual(['Arch Manning'])
    expect(ctx.bench.map((p) => [p.playerId, p.name])).toEqual([['fantrax:07abc', 'Jeremiah Smith']])
    expect(ctx.rosterPlayerCount).toBe(2)
  })

  it('ESPN: translated ids keep their Sleeper identity; an untranslated one is named and COUNTED, not dropped', async () => {
    state.playerData = { players: ['4430807', '4262921'], starters: ['4430807'] }
    state.espnMap = new Map([['4430807', '9999']])
    state.providerNames = new Map([['4262921', { name: "De'Von Achane", position: null, team: null }]])
    const ctx = await contextFor('espn')
    expect(ctx.starters[0]).toMatchObject({ playerId: '9999', name: 'Right Player' })
    expect(ctx.bench[0]).toMatchObject({ playerId: 'espn:4262921', name: "De'Von Achane" })
    expect(ctx.dataGaps.join(' ')).toContain("1 of 2 players are named from ESPN's own player ids")
  })

  it('an empty slot stays an empty slot', async () => {
    state.playerData = { players: ['0'], starters: ['0'] }
    const ctx = await contextFor('mfl')
    expect(ctx.starters[0]!.playerId).toBe('0')
  })

  it('CONTROL: the same id in a Sleeper league IS named', async () => {
    const ctx = await contextFor('sleeper')
    expect(ctx.starters.map((p) => p.name)).toEqual(['Wrong Player'])
    expect(ctx.dataGaps).toEqual([])
  })
})
