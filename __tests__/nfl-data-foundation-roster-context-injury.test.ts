// @vitest-environment node
/**
 * 🛑 `getCanonicalNflRosterContext` — the roster context behind `/api/redraft/matchup` — let the STORED
 * `RedraftRosterPlayer.injuryStatus` win over the canonical designation, in both `injuryStatus` and the
 * "unavailable by injury status" lineup warning. The stored column is a snapshot written at import or
 * refresh time and stale by construction: last week's "Out" kept a cleared starter flagged, and a stored
 * "Questionable" hid a player the live feed now has Out.
 *
 * The canonical designation is `loadInjuryStatus`: the live injury feed by verified name, or Sleeper's
 * own season-scale roster absence. The fake database honours each query's `where`.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { getCanonicalNflRosterContext } from '@/lib/nfl-data-foundation/nflDataFoundationService'

const NOW = new Date()
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)
const inDays = (d: number) => new Date(NOW.getTime() + d * 24 * 3_600_000)
const UNAVAILABLE = 'Player is unavailable by injury status.'

type Row = Record<string, unknown>

function sp(id: string, name: string, position: string, team: string, status: string | null, sleeperId: string): Row {
  return {
    id,
    sport: 'NFL',
    externalId: `sleeper:${sleeperId}`,
    name,
    position,
    team,
    teamId: null,
    number: null,
    imageUrl: null,
    sleeperId,
    status,
    source: 'sleeper',
    fetchedAt: hoursAgo(1),
    expiresAt: inDays(1),
    updatedAt: hoursAgo(1),
  }
}

function injury(over: Row): Row {
  return {
    sport: 'NFL',
    playerId: null,
    playerName: 'Nobody',
    team: null,
    position: null,
    status: 'Out',
    date: hoursAgo(20),
    fetchedAt: hoursAgo(1),
    expiresAt: inDays(2),
    ...over,
  }
}

function rosterRow(playerId: string, playerName: string, position: string, team: string, injuryStatus: string | null): Row {
  return { playerId, playerName, position, team, slotType: position, isLocked: false, injuryStatus }
}

function fakeDb(players: Row[], injuries: Row[], rosterPlayers: Row[]) {
  const empty = new Proxy(
    {},
    { get: (_t, method: string) => async () => (String(method).startsWith('findMany') ? [] : String(method) === 'count' ? 0 : null) },
  )
  const real: Record<string, unknown> = {
    redraftRoster: {
      findUnique: async () => ({
        leagueId: 'league-1',
        season: { season: 2026, currentWeek: 6, sport: 'NFL' },
        players: rosterPlayers,
      }),
    },
    league: { findUnique: async () => ({ settings: {} }) },
    sportsPlayer: {
      findMany: async ({ where }: { where: unknown }) => {
        const w = JSON.stringify(where)
        return players.filter((p) => w.includes(`"${p.id}"`))
      },
      findFirst: async () => null,
    },
    sportsInjury: {
      findMany: async ({ where }: { where: { sport: string; expiresAt?: { gt: Date } } }) =>
        injuries.filter(
          (r) => r.sport === where.sport && (!where.expiresAt || (r.expiresAt as Date).getTime() > where.expiresAt.gt.getTime()),
        ),
    },
  }
  return new Proxy(real, { get: (t, key: string) => (key in t ? t[key] : empty) }) as never
}

async function context(players: Row[], injuries: Row[], rosterPlayers: Row[]) {
  const ctx = await getCanonicalNflRosterContext('roster-1', { prismaClient: fakeDb(players, injuries, rosterPlayers), now: NOW })
  return Object.fromEntries(ctx.map((p) => [p.playerName, p]))
}

describe('getCanonicalNflRosterContext — the canonical designation wins over the stored snapshot', () => {
  it('🛑 a stored "Out" the feed no longer carries is not served as current', async () => {
    const got = await context(
      [sp('sp-cleared', 'Cleared Back', 'RB', 'NYG', 'Active', '6001')],
      [],
      [rosterRow('sp-cleared', 'Cleared Back', 'RB', 'NYG', 'Out')],
    )
    expect(got['Cleared Back'], 'the player must resolve through the real canonical builder').toBeDefined()
    expect(got['Cleared Back'].injuryStatus).toBeNull()
    expect(got['Cleared Back'].lineupWarnings).not.toContain(UNAVAILABLE)
  })

  it('🛑 a stored "Questionable" does not hide a player the live feed has Out', async () => {
    const got = await context(
      [sp('sp-out', 'Hurt Today', 'WR', 'DET', 'Active', '6002')],
      [injury({ playerName: 'Hurt Today', team: 'Detroit Lions', position: 'WR', status: 'Out' })],
      [rosterRow('sp-out', 'Hurt Today', 'WR', 'DET', 'Questionable')],
    )
    expect(got['Hurt Today'].injuryStatus).toBe('Out')
    expect(got['Hurt Today'].lineupWarnings).toContain(UNAVAILABLE)
  })

  it("Sleeper's own season-scale roster absence still flags the player (control)", async () => {
    const got = await context(
      [sp('sp-ir', 'Season Over', 'TE', 'KC', 'Injured Reserve', '6003')],
      [],
      [rosterRow('sp-ir', 'Season Over', 'TE', 'KC', null)],
    )
    expect(got['Season Over'].injuryStatus).toBe('Injured Reserve')
    expect(got['Season Over'].lineupWarnings).toContain(UNAVAILABLE)
  })
})
