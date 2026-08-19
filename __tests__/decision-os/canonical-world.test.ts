import { describe, expect, it, vi } from 'vitest'
import {
  assembleCanonicalWorld,
  matchTeamIdForRoster,
} from '@/lib/decision-os/world/assemble'
import { resolveCanonicalWorld } from '@/lib/decision-os/world'
import type { CanonicalWorldPort } from '@/lib/decision-os/world/port'
import {
  makeImportedProviderWorld,
  makeNativeAfWorld,
} from './canonicalWorldFakes'

const NOW = new Date('2025-10-01T12:00:00.000Z')

describe('Canonical World Assembly — substrate behavior (origin-blind facts)', () => {
  it('(1) assembles an origin-blind world from an IMPORTED provider league', () => {
    const world = assembleCanonicalWorld(makeImportedProviderWorld(), { now: NOW })

    expect(world.league.leagueId).toBe('lg-import-1')
    expect(world.league.sport).toBe('NFL')
    expect(world.league.season).toBe(2025)
    expect(world.teams).toHaveLength(2)
    expect(world.rosters).toHaveLength(2)

    // Origin survives ONLY in provenance, never in the league/team/roster facts themselves.
    expect(world.provenance.provider).toBe('sleeper')
    expect(world.provenance.sourceLeagueId).toBe('sleeper-league-9999')
    expect(JSON.stringify(world.league)).not.toContain('sleeper')
    expect(JSON.stringify(world.rosters)).not.toContain('sleeper')

    // Roster→team join resolved via source_team_id → externalId.
    const rosterA = world.rosters.find((r) => r.rosterId === 'roster-row-A')!
    expect(rosterA.teamId).toBe('team-A')
  })

  it('(2) assembles a structurally identical world from a NATIVE AllFantasy league', () => {
    const world = assembleCanonicalWorld(makeNativeAfWorld(), { now: NOW })

    expect(world.league.leagueId).toBe('lg-native-1')
    expect(world.provenance.provider).toBeNull() // native: no provider
    expect(world.teams).toHaveLength(1)
    expect(world.rosters).toHaveLength(1)

    // Same fact keys as the imported world (origin-blind contract).
    const importedKeys = Object.keys(
      assembleCanonicalWorld(makeImportedProviderWorld(), { now: NOW }).teams[0],
    ).sort()
    const nativeKeys = Object.keys(world.teams[0]).sort()
    expect(nativeKeys).toEqual(importedKeys)

    const roster = world.rosters[0]
    expect(roster.teamId).toBe('nteam-A') // joined via platformUserId
  })

  it('(3) derives FAAB remaining from budget − used when not stored', () => {
    // Imported world: no stored remaining, but inject a persisted waiver_budget_used to derive from.
    const input = makeImportedProviderWorld()
    input.rosters[0].settings = { waiver_budget_used: 35 }
    const world = assembleCanonicalWorld(input, { now: NOW })

    const teamA = world.teams.find((t) => t.teamId === 'team-A')!
    expect(teamA.faab.budget).toBe(100)
    expect(teamA.faab.used).toBe(35)
    expect(teamA.faab.remaining).toBe(65)
    expect(teamA.faab.remainingDerived).toBe(true)
  })

  it('(3b) prefers a stored FAAB remaining over derivation (native league)', () => {
    const world = assembleCanonicalWorld(makeNativeAfWorld(), { now: NOW })
    const team = world.teams[0]
    expect(team.faab.remaining).toBe(73)
    expect(team.faab.remainingDerived).toBe(false)
  })

  it('(4) degrades FAAB gracefully (null + warning) when neither stored nor derivable', () => {
    // Default imported world: faabRemaining null AND no persisted waiver_budget_used.
    const world = assembleCanonicalWorld(makeImportedProviderWorld(), { now: NOW })

    for (const team of world.teams) {
      expect(team.faab.remaining).toBeNull()
      expect(team.faab.remainingDerived).toBe(false)
    }
    expect(world.completeness.warnings.some((w) => w.startsWith('faab_remaining_unavailable'))).toBe(true)
  })

  it('(5) derives current week from the latest TeamPerformance', () => {
    const world = assembleCanonicalWorld(makeImportedProviderWorld(), { now: NOW })
    expect(world.league.currentWeek).toBe(2)
    expect(world.league.currentWeekBasis).toBe('team_performance')

    // No performances → null + warning, never a guess.
    const noPerf = assembleCanonicalWorld(
      makeImportedProviderWorld({ performances: [] }),
      { now: NOW },
    )
    expect(noPerf.league.currentWeek).toBeNull()
    expect(noPerf.league.currentWeekBasis).toBe('unavailable')
    expect(noPerf.completeness.warnings.some((w) => w.startsWith('current_week_unavailable'))).toBe(true)
  })

  it('(6) projects roster slots from playerData (starters/bench/reserve/taxi, drops "0")', () => {
    const world = assembleCanonicalWorld(makeImportedProviderWorld(), { now: NOW })
    const rosterA = world.rosters.find((r) => r.rosterId === 'roster-row-A')!

    // "0" placeholder dropped; 4 real players.
    expect(rosterA.playerIds).toEqual(['4046', '6794', '4035', '2133'])
    expect(rosterA.playerCount).toBe(4)
    expect(rosterA.starterIds).toEqual(['4046', '6794', '4035'])
    expect(rosterA.reserveIds).toEqual(['2133'])
    // bench = players − (starters ∪ reserve ∪ taxi) → empty here
    expect(rosterA.benchIds).toEqual([])
    expect(rosterA.playerMetadataEnriched).toBe(false)
  })

  it('(7) recovers pointsAgainst from performances when not stored', () => {
    const world = assembleCanonicalWorld(makeImportedProviderWorld(), { now: NOW })
    const teamA = world.teams.find((t) => t.teamId === 'team-A')!

    // team-A opponents were team-B both weeks: 100 (wk1) + 110 (wk2) = 210.
    expect(teamA.pointsAgainst).toBe(210)
    expect(teamA.pointsAgainstBasis).toBe('derived_from_performances')

    // Native league stores PA directly → basis "stored".
    const native = assembleCanonicalWorld(makeNativeAfWorld(), { now: NOW })
    expect(native.teams[0].pointsAgainst).toBe(743.6)
    expect(native.teams[0].pointsAgainstBasis).toBe('stored')
  })

  it('(7b) warns when pointsAgainst is neither stored nor derivable', () => {
    // Strip opponents so PA cannot be reconstructed, and leave stored PA at 0.
    const input = makeImportedProviderWorld()
    input.performances = input.performances.map((p) => ({ ...p, opponent: null }))
    const world = assembleCanonicalWorld(input, { now: NOW })

    expect(world.teams.every((t) => t.pointsAgainst === null)).toBe(true)
    expect(world.teams.every((t) => t.pointsAgainstBasis === 'unavailable')).toBe(true)
    expect(world.completeness.warnings.some((w) => w.startsWith('points_against_unavailable'))).toBe(true)
  })

  it('(8) records provenance metadata: source models, freshness, assembledAt', () => {
    const world = assembleCanonicalWorld(makeImportedProviderWorld(), { now: NOW })

    expect(world.provenance.sourceModels).toEqual(['League', 'LeagueTeam', 'Roster', 'TeamPerformance'])
    expect(world.provenance.assembledAt).toBe(NOW.toISOString())
    expect(world.provenance.freshness.lastSyncedAt).toBe('2025-10-01T00:00:00.000Z')
    expect(world.provenance.freshness.isStale).toBe(false)

    // Stale path: synced long before `now`.
    const stale = assembleCanonicalWorld(makeImportedProviderWorld(), {
      now: new Date('2025-10-05T00:00:00.000Z'),
      staleAfterMs: 24 * 60 * 60 * 1000,
    })
    expect(stale.provenance.freshness.isStale).toBe(true)
    expect(stale.provenance.freshness.staleReason).toBe('sync_older_than_threshold')

    // Never-synced path.
    const neverSynced = assembleCanonicalWorld(
      makeImportedProviderWorld({
        league: { ...makeImportedProviderWorld().league, lastSyncedAt: null },
      }),
      { now: NOW },
    )
    expect(neverSynced.provenance.freshness.isStale).toBe(true)
    expect(neverSynced.provenance.freshness.staleReason).toBe('never_synced')
  })

  it('(8b) marks unsupported fields explicitly rather than silently omitting them', () => {
    const world = assembleCanonicalWorld(makeImportedProviderWorld(), { now: NOW })
    expect(world.completeness.unsupported.some((u) => u.startsWith('player_metadata'))).toBe(true)
    expect(world.completeness.dataCompleteness).toBeGreaterThan(0)
    expect(world.completeness.dataCompleteness).toBeLessThanOrEqual(100)
  })

  it('(9) read-only safety: resolveCanonicalWorld calls ONLY read methods on the port', async () => {
    const fixture = makeImportedProviderWorld()
    const port: CanonicalWorldPort = {
      loadLeague: vi.fn(async () => fixture.league),
      loadTeams: vi.fn(async () => fixture.teams),
      loadRosters: vi.fn(async () => fixture.rosters),
      loadPerformances: vi.fn(async () => fixture.performances),
    }

    const world = await resolveCanonicalWorld('lg-import-1', { port, now: NOW })

    expect(world).not.toBeNull()
    expect(port.loadLeague).toHaveBeenCalledWith('lg-import-1')
    expect(port.loadTeams).toHaveBeenCalledWith('lg-import-1')
    expect(port.loadPerformances).toHaveBeenCalledWith(['team-A', 'team-B'], 2025)

    // The port surface itself exposes ONLY read methods — there is no write method to call.
    expect(Object.keys(port).sort()).toEqual(
      ['loadLeague', 'loadPerformances', 'loadRosters', 'loadTeams'],
    )
  })

  it('(9b) resolveCanonicalWorld returns null when the league row is missing', async () => {
    const port: CanonicalWorldPort = {
      loadLeague: vi.fn(async () => null),
      loadTeams: vi.fn(async () => []),
      loadRosters: vi.fn(async () => []),
      loadPerformances: vi.fn(async () => []),
    }
    const world = await resolveCanonicalWorld('missing', { port })
    expect(world).toBeNull()
    expect(port.loadTeams).not.toHaveBeenCalled()
  })

  it('matchTeamIdForRoster falls back through platformUserId and claim, returns null on miss', () => {
    const { teams } = makeImportedProviderWorld()

    // No source_team_id, but platformUserId matches team-B.platformUserId.
    expect(
      matchTeamIdForRoster(
        { id: 'r', platformUserId: 'sleeper-user-222', playerData: {}, faabRemaining: null, waiverPriority: null, settings: null },
        teams,
      ),
    ).toBe('team-B')

    // platformUserId matches team-A.claimedByUserId.
    expect(
      matchTeamIdForRoster(
        { id: 'r', platformUserId: 'af-user-777', playerData: {}, faabRemaining: null, waiverPriority: null, settings: null },
        teams,
      ),
    ).toBe('team-A')

    // No match at all → null (surfaced as completeness warning, never repaired).
    expect(
      matchTeamIdForRoster(
        { id: 'r', platformUserId: 'nobody', playerData: {}, faabRemaining: null, waiverPriority: null, settings: null },
        teams,
      ),
    ).toBeNull()
  })
})
