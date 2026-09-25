import { describe, expect, it, vi } from 'vitest'
import {
  loadClaimedTeamRosterFrom,
  loadWaiverWorldFacts,
  type WaiverLoaderDeps,
} from '@/lib/decision-os/waiver/loader'

function buildDeps(overrides: Partial<WaiverLoaderDeps> = {}): WaiverLoaderDeps {
  return {
    loadEffectiveSettings: async () => ({
      waiverType: 'faab',
      normalizedWaiverType: 'faab',
      faabBudget: 100,
      claimLimitPerPeriod: null,
      claimLimitPerWeek: null,
      maxDropsPerWeek: null,
      lockType: null,
    }),
    loadLeagueSport: async () => 'NFL',
    loadLinkedPlatformUserIds: async () => ['app-user', 'sleep-123'],
    loadUserRoster: async () => ({
      id: 'roster-1',
      faabRemaining: 22,
      waiverPriority: 5,
      playerData: { players: ['p1', 'p2', 'p3'] },
    }),
    hasSettingsRow: async () => true,
    ...overrides,
  }
}

describe('loadWaiverWorldFacts', () => {
  it('uses linked Sleeper platform ids when resolving imported canonical rosters', async () => {
    const loadUserRoster = vi.fn(async (_leagueId: string, platformUserIds: string[]) => ({
      id: 'roster-1',
      faabRemaining: 22,
      waiverPriority: 5,
      playerData: { players: ['p1', 'p2', 'p3'] },
    }))

    const facts = await loadWaiverWorldFacts(
      'app-user',
      'league-1',
      buildDeps({ loadUserRoster }),
    )

    expect(loadUserRoster).toHaveBeenCalledWith('league-1', ['app-user', 'sleep-123'])
    expect(facts?.rosterId).toBe('roster-1')
    expect(facts?.settingsKnown).toBe(true)
    expect(facts?.rosterSize).toBe(3)
  })

  it('returns null when no canonical roster can be resolved', async () => {
    const facts = await loadWaiverWorldFacts(
      'app-user',
      'league-1',
      buildDeps({ loadUserRoster: async () => null }),
    )

    expect(facts).toBeNull()
  })
})

/*
 * 🛑 A Fantrax/MFL roster is keyed on the provider's own manager id (or `orphan-<provider>-<team>`),
 * never the app user id or the linked Sleeper id, so the waiver shadow used to skip every manager
 * in those leagues as "no roster". The claimed team is the join that reaches them.
 */
describe('loadWaiverWorldFacts — claimed-team fallback', () => {
  const claimedRoster = { id: 'fantrax-roster', faabRemaining: 40, waiverPriority: 2, playerData: { players: ['a'] } }

  it('falls back to the claimed team when the linked ids find nothing', async () => {
    const loadClaimedTeamRoster = vi.fn(async () => claimedRoster)
    const facts = await loadWaiverWorldFacts(
      'app-user',
      'league-1',
      buildDeps({ loadUserRoster: async () => null, loadClaimedTeamRoster }),
    )
    expect(loadClaimedTeamRoster).toHaveBeenCalledWith('league-1', 'app-user')
    expect(facts?.rosterId).toBe('fantrax-roster')
    expect(facts?.faabRemaining).toBe(40)
  })

  it('never consults the claim when the linked ids already found the roster (Sleeper unchanged)', async () => {
    const loadClaimedTeamRoster = vi.fn(async () => claimedRoster)
    const facts = await loadWaiverWorldFacts('app-user', 'league-1', buildDeps({ loadClaimedTeamRoster }))
    expect(loadClaimedTeamRoster).not.toHaveBeenCalled()
    expect(facts?.rosterId).toBe('roster-1')
  })

  it('is still null when neither join finds a roster', async () => {
    const facts = await loadWaiverWorldFacts(
      'app-user',
      'league-1',
      buildDeps({ loadUserRoster: async () => null, loadClaimedTeamRoster: async () => null }),
    )
    expect(facts).toBeNull()
  })
})

describe('loadClaimedTeamRosterFrom', () => {
  type Row = { id: string; platformUserId: string | null; faabRemaining: number | null; waiverPriority: number | null; playerData: unknown }
  function db(team: { platformUserId: string | null; externalId: string | null } | null, rosters: Row[]) {
    return {
      leagueTeam: { findFirst: vi.fn(async () => team) },
      roster: {
        findFirst: vi.fn(async (a: unknown) => {
          const keys = (a as { where: { platformUserId: { in: string[] } } }).where.platformUserId.in
          return rosters.find((r) => r.platformUserId != null && keys.includes(r.platformUserId)) ?? null
        }),
        findMany: vi.fn(async () => rosters),
      },
    }
  }
  const row = (id: string, platformUserId: string, sourceTeamId: string): Row => ({
    id,
    platformUserId,
    faabRemaining: 10,
    waiverPriority: 1,
    playerData: { source_team_id: sourceTeamId, players: [] },
  })

  it('matches a provider-keyed roster through the claimed team', async () => {
    const d = db({ platformUserId: 'fantrax-mgr-9', externalId: 't9' }, [row('r1', 'fantrax-mgr-1', 't1'), row('r9', 'fantrax-mgr-9', 't9')])
    expect((await loadClaimedTeamRosterFrom(d, 'L', 'app-user'))?.id).toBe('r9')
  })

  it('finds an orphan-keyed roster by the team id when no owner key matches', async () => {
    const d = db({ platformUserId: null, externalId: '0003' }, [row('r1', 'owner-a', '0001'), row('r3', 'orphan-mfl-0003', '0003')])
    expect((await loadClaimedTeamRosterFrom(d, 'L', 'app-user'))?.id).toBe('r3')
  })

  it('is null when the user has claimed no team — it never guesses another manager', async () => {
    const d = db(null, [row('r1', 'owner-a', '0001')])
    expect(await loadClaimedTeamRosterFrom(d, 'L', 'app-user')).toBeNull()
    expect(d.roster.findMany).not.toHaveBeenCalled()
  })
})
