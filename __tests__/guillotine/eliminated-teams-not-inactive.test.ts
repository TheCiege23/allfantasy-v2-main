import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A chopped team is out of the league, not inactive (2026-11-20).
 *
 * A commissioner who runs several chopped leagues reported every eliminated team flagged INACTIVE:
 * a chopped manager's roster is released and they can no longer act, so every "has this manager done
 * anything lately" check aged them into inactive. Each surface below is tested with and without the
 * eliminated teams, so a green run cannot mean the filter was never reached.
 */

const mocks = vi.hoisted(() => ({
  leagueFindMany: vi.fn(),
  leagueFindUnique: vi.fn(),
  chopFindMany: vi.fn(),
  matchupFindMany: vi.fn(),
  teamFindMany: vi.fn(),
  rosterFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => {
  const none = vi.fn(async () => [])
  return {
    prisma: {
      league: { findMany: mocks.leagueFindMany, findUnique: mocks.leagueFindUnique },
      guillotineRosterState: { findMany: mocks.chopFindMany },
      weeklyMatchup: { findMany: mocks.matchupFindMany },
      leagueTeam: { findMany: mocks.teamFindMany },
      roster: { findMany: mocks.rosterFindMany },
      waiverClaim: { groupBy: none },
      waiverTransaction: { groupBy: none },
      afLeagueTrade: { groupBy: none },
      redraftWaiverClaim: { groupBy: none },
      redraftTradeProposal: { groupBy: none },
    },
  }
})

import { importedChoppedProviderIds, resolveEliminatedTeams, readEliminatedTeams } from '@/lib/guillotine/eliminatedTeams'
import { getLeagueManagerHealth } from '@/lib/commissioner-hub/managerHealth'
import { buildCommissionerHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import { memberActivityFromReads } from '@/lib/core-app/commissioner/activity'

const NOW = new Date('2026-11-20T12:00:00.000Z')
const STALE = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000)
const lineup = { players: ['p1'], starters: ['p1'], lineup_sections: { starters: [{ id: 'p1', position: 'QB' }], bench: [] } }
const released = { players: [], starters: [], lineup_sections: { starters: [], bench: [] } }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  for (const m of Object.values(mocks)) m.mockReset()
  mocks.leagueFindMany.mockResolvedValue([])
  mocks.leagueFindUnique.mockResolvedValue({ starters: ['QB'] })
  mocks.chopFindMany.mockResolvedValue([])
  mocks.matchupFindMany.mockResolvedValue([])
  mocks.teamFindMany.mockResolvedValue([])
  mocks.rosterFindMany.mockResolvedValue([])
})

describe('importedChoppedProviderIds — the imported Guilly tab’s rule', () => {
  const row = (week: number, rosterId: string, pointsFor: number) => ({ week, rosterId, pointsFor, matchupId: null })

  it('chops each completed week’s lowest scorer, and not the week still being played', () => {
    const rows = [
      row(1, '1', 120), row(1, '2', 100), row(1, '3', 80),
      row(2, '1', 110), row(2, '2', 90), row(2, '3', 0),
      row(3, '1', 50), row(3, '2', 0), row(3, '3', 0),
    ]
    // Week 3 is the current week: '1' is the only scorer left, but nothing is chopped from it yet.
    expect(importedChoppedProviderIds(rows)).toEqual(['3', '2'])
  })

  it('chops nobody on a tie at the bottom, and nobody before a score', () => {
    expect(importedChoppedProviderIds([row(1, '1', 90), row(1, '2', 90), row(2, '1', 10)])).toEqual([])
    expect(importedChoppedProviderIds([row(1, '1', 0), row(1, '2', 0)])).toEqual([])
  })
})

describe('resolveEliminatedTeams', () => {
  const teams = [
    { externalId: 'r1', platformUserId: 'u1', teamName: 'Alive', ownerName: 'alive_owner' },
    { externalId: 'r2', platformUserId: 'u2', teamName: 'Chopped Native', ownerName: 'native_owner' },
    { externalId: '7', platformUserId: 'u7', teamName: 'Chopped Import', ownerName: 'import_owner' },
  ]
  const rosters = [{ id: 'r1', platformUserId: 'u1' }, { id: 'r2', platformUserId: 'u2' }, { id: 'r7', platformUserId: 'u7' }]

  it('keys a native chop and an imported chop by roster id and by both names', () => {
    const out = resolveEliminatedTeams({ choppedRosterIds: ['r2'], importedProviderIds: ['7'], teams, rosters })
    expect([...out.rosterIds].sort()).toEqual(['r2', 'r7'])
    expect([...out.names].sort()).toEqual(['Chopped Import', 'Chopped Native', 'import_owner', 'native_owner'])
  })

  it('[control] no chops is nobody', () => {
    const out = resolveEliminatedTeams({ choppedRosterIds: [], importedProviderIds: [], teams, rosters })
    expect(out.rosterIds.size + out.names.size).toBe(0)
  })
})

describe('readEliminatedTeams degrades instead of throwing', () => {
  it('returns nobody when the read fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.leagueFindMany.mockRejectedValue(new Error('db down'))
    const out = await readEliminatedTeams('lg')
    expect(out.rosterIds.size + out.names.size).toBe(0)
    warn.mockRestore()
  })
})

describe('Commissioner Hub manager table (getLeagueManagerHealth)', () => {
  const rows = [
    { id: 'r1', platformUserId: 'u1', playerData: lineup, updatedAt: NOW, redraftRosterId: null, faabRemaining: null },
    { id: 'r2', platformUserId: 'u2', playerData: lineup, updatedAt: STALE, redraftRosterId: null, faabRemaining: null },
    { id: 'r3', platformUserId: 'u3', playerData: released, updatedAt: STALE, redraftRosterId: null, faabRemaining: null },
  ]

  beforeEach(() => {
    mocks.rosterFindMany.mockResolvedValue(rows)
    mocks.leagueFindMany.mockResolvedValue([{ id: 'lg', platform: 'allfantasy', platformLeagueId: null, season: 2026, leagueType: 'guillotine', guillotineMode: true, settings: {} }])
  })

  it('🛑 leaves a chopped team out instead of calling it inactive', async () => {
    mocks.chopFindMany.mockResolvedValue([{ leagueId: 'lg', rosterId: 'r3' }])
    const health = await getLeagueManagerHealth('lg')
    expect(health.rows.map((r) => r.rosterId).sort()).toEqual(['r1', 'r2'])
    // A live manager who has gone quiet is still reported.
    expect(health.inactiveCount).toBe(1)
    expect(health.rows.find((r) => r.rosterId === 'r2')?.status).toBe('inactive')
  })

  it('[control] without the chop, the same team reads inactive', async () => {
    const health = await getLeagueManagerHealth('lg')
    expect(health.inactiveCount).toBe(2)
    expect(health.rows.find((r) => r.rosterId === 'r3')?.status).toBe('inactive')
  })
})

describe('Commissioner Hub league health (buildCommissionerHealthSnapshot)', () => {
  const rosters = [
    { id: 'a', platformUserId: 'u1', updatedAt: NOW, playerData: lineup },
    { id: 'b', platformUserId: 'u2', updatedAt: STALE, playerData: released },
    { id: 'c', platformUserId: 'u3', updatedAt: STALE, playerData: released },
  ]
  const metrics = (eliminatedRosterIds?: Set<string>) =>
    buildCommissionerHealthSnapshot({
      now: NOW,
      eliminatedRosterIds,
      league: { id: 'l', name: 'L', sport: 'NFL', leagueType: 'guillotine', leagueSize: 3, rosters },
    } as never).metrics

  it('🛑 a chopped team is neither inactive nor a missed lineup', () => {
    const m = metrics(new Set(['b', 'c']))
    expect(m.inactiveTeams).toBe(0)
    expect(m.missedLineups).toBe(0)
    expect(m.activeManagers).toBe(1)
  })

  it('[control] without the chops, both count against the league', () => {
    const m = metrics()
    expect(m.inactiveTeams).toBe(2)
    expect(m.missedLineups).toBe(2)
  })
})

describe('imported league member activity (memberActivityFromReads)', () => {
  const teams = ['Alive', 'Quiet', 'Chopped'].map((teamName, i) => ({
    teamName, ownerName: null, isOrphan: false, claimedByUserId: null, platformUserId: `u${i}`,
  }))
  const activity = (eliminatedNames?: string[]) =>
    memberActivityFromReads(
      {
        native: false,
        managers: [
          { managerName: 'Alive', currentCount: 3, priorCount: 1 },
          // Made moves before the chop, none since: the window still saw them.
          { managerName: 'Chopped', currentCount: 0, priorCount: 4 },
        ],
        window: { lastActivityAt: NOW, eventCount: 20 },
        eliminatedNames,
      },
      teams as never,
      NOW,
      14,
    )

  it('🛑 leaves a chopped team out of both the move list and the silent list', () => {
    const a = activity(['Chopped'])
    expect(a.available).toBe(true)
    if (!a.available) return
    expect(a.data.rows.map((r) => [r.name, r.status])).toEqual([['Quiet', 'inactive'], ['Alive', 'active']])
  })

  it('[control] without it, the chopped team reads inactive', () => {
    const a = activity()
    if (!a.available) throw new Error('expected activity')
    expect(a.data.rows.find((r) => r.name === 'Chopped')?.status).toBe('inactive')
  })
})
