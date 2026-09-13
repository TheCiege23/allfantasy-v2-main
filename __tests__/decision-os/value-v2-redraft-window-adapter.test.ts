import { describe, expect, it } from 'vitest'
import {
  resolveRedraftTeamWindow, resolveRequestingTeam,
  WINDOW_GAP_TEAM_READ_FAILED, WINDOW_GAP_LEAGUE_MISSING, WINDOW_GAP_PERIOD_UNRESOLVED,
  WINDOW_GAP_TEAM_AMBIGUOUS, WINDOW_GAP_ARCHIVAL_UNPROVABLE, WINDOW_GAP_TEAM_ID_MISSING,
  WINDOW_GAP_TEAM_NOT_CLAIMED,
} from '@/lib/decision-os/value-v2/redraftWindowServerAdapter'
import { NEUTRAL_TEAM_FIT } from '@/lib/decision-os/value-v2/windowDecision'

/**
 * The identity half of the redraft consumer seam.
 *
 * 🛑 WHAT THIS EXISTS TO CATCH IS AN ATTRIBUTION BUG, NOT A CRASH. The caller holds a
 * `RedraftRoster.id`; the port wants `LeagueTeam.externalId`. If those are ever conflated, or if
 * an ambiguous result is resolved by taking the first row, the window returned describes SOMEBODY
 * ELSE'S TEAM — and every assertion about "a window came back" still passes. So the tests below
 * assert WHICH team, and assert the refusals by name, rather than asserting that something
 * non-null was produced.
 *
 * ⚠ THE PRISMA DOUBLE RECORDS EVERY READ. "No evidence was read" is the load-bearing claim for a
 * refusal — a refusal that still queried a league's matchups has leaked the thing the route's
 * gates exist to protect — so it is proved by a call log, not asserted about.
 */

type Read = { model: string; args: unknown }

function fakePrisma(over: {
  league?: unknown
  leagueTeams?: Array<{ externalId: string; isOrphan: boolean }>
  leagueTeamThrows?: boolean
  rosterPlayers?: Array<{ rosterId?: string; playerId: string | null }>
  leagueRosterPlayers?: Array<{ rosterId: string; playerId: string | null }>
  rosterPlayerThrows?: boolean
  schedule?: Array<{ week: number }>
  scheduleThrows?: boolean
  projections?: Array<{ playerId: string; rosProjection: number | null; rosWeeksRemaining: number | null; computedAt: Date }>
  projectionThrows?: boolean
  identityMap?: Array<{ id: string; sleeperId: string }>
  identityMapThrows?: boolean
  leagueThrows?: boolean
} = {}) {
  const reads: Read[] = []
  const log = (model: string) => (args: unknown) => { reads.push({ model, args }); return args }
  const prisma = {
    league: {
      findUnique: async (args: unknown) => {
        log('league.findUnique')(args)
        if (over.leagueThrows) throw new Error('league read down')
        return over.league === undefined ? { platformLeagueId: 'sleeper-1', platform: 'sleeper' } : over.league
      },
    },
    leagueTeam: {
      findMany: async (args: unknown) => {
        log('leagueTeam.findMany')(args)
        if (over.leagueTeamThrows) throw new Error('db down')
        return over.leagueTeams ?? []
      },
      /*
       * ⚠ THE PORT'S OWN IDENTITY READ, AND OMITTING IT COST A DIAGNOSIS. `createWindowFactsPrismaPort`
       * calls `leagueTeam.findFirst` for team/manager identity. A double that defines only
       * `findMany` throws `findFirst is not a function` inside the port — which the adapter's
       * catch correctly reported as a named read failure, i.e. the test double's hole
       * arrived looking exactly like a database outage. Doubles have to cover every method the
       * subject reaches, or they test the double.
       */
      findFirst: async (args: unknown) => {
        log('leagueTeam.findFirst')(args)
        const first = (over.leagueTeams ?? [])[0]
        return first ? { externalId: first.externalId, teamName: 'Anvil Chorus', ownerName: 'Rae' } : null
      },
    },
    redraftRosterPlayer: {
      findMany: async (args: unknown) => {
        const a = args as { where?: { rosterId?: string; roster?: { seasonId?: string } } }
        // The adapter makes TWO different reads here: the proposer's roster, and every roster in
        // the season for the league-relative rest-of-season denominator.
        const which = a?.where?.roster ? 'redraftRosterPlayer.findMany:league' : 'redraftRosterPlayer.findMany'
        log(which)(args)
        if (over.rosterPlayerThrows) throw new Error('roster read down')
        return a?.where?.roster ? (over.leagueRosterPlayers ?? []) : (over.rosterPlayers ?? [])
      },
    },
    redraftMatchup: {
      findMany: async (args: unknown) => {
        log('redraftMatchup.findMany')(args)
        if (over.scheduleThrows) throw new Error('schedule read down')
        return over.schedule ?? []
      },
    },
    aFProjectionSnapshot: {
      findMany: async (args: unknown) => {
        log('aFProjectionSnapshot.findMany')(args)
        if (over.projectionThrows) throw new Error('projection read down')
        // Applies the id filter the real client would, so a loader that asks for the WRONG ids gets
        // the wrong rows here rather than every fixture row regardless of what it asked for.
        const ids = (args as { where?: { playerId?: { in?: string[] } } })?.where?.playerId?.in
        const rows = over.projections ?? []
        return ids ? rows.filter(r => ids.includes(r.playerId)) : rows
      },
    },
    playerIdentityMap: {
      findMany: async (args: unknown) => {
        log('playerIdentityMap.findMany')(args)
        if (over.identityMapThrows) throw new Error('identity map read down')
        const ids = (args as { where?: { sleeperId?: { in?: string[] } } })?.where?.sleeperId?.in ?? []
        return (over.identityMap ?? []).filter(m => ids.includes(m.sleeperId))
      },
    },
    weeklyMatchup: { findMany: async (args: unknown) => { log('weeklyMatchup.findMany')(args); return [] } },
    seasonForecastSnapshot: { findFirst: async (a: unknown) => { log('seasonForecastSnapshot.findFirst')(a); return null } },
    dynastyProjectionSnapshot: { findFirst: async (a: unknown) => { log('dynastyProjectionSnapshot.findFirst')(a); return null } },
    sportsPlayer: { findMany: async (a: unknown) => { log('sportsPlayer.findMany')(a); return [] } },
  }
  return { prisma: prisma as never, reads }
}

const base = {
  leagueId: 'af-league-uuid', userId: 'user-1', proposerRosterId: 'redraft-roster-cuid',
  seasonId: 'redraft-season-cuid', sport: 'NFL', season: 2026, week: 6,
}

describe('resolveRequestingTeam maps the caller onto exactly one canonical team', () => {
  it('returns the claimed team externalId', async () => {
    const { prisma } = fakePrisma({ leagueTeams: [{ externalId: '7', isOrphan: false }] })
    const r = await resolveRequestingTeam(prisma, 'l1', 'user-1')
    expect(r).toEqual({ ok: true, externalId: '7' })
  })

  it('refuses when the caller has claimed no team', async () => {
    const { prisma } = fakePrisma({ leagueTeams: [] })
    expect(await resolveRequestingTeam(prisma, 'l1', 'user-1')).toEqual({ ok: false, gap: WINDOW_GAP_TEAM_NOT_CLAIMED })
  })

  /*
   * 🛑 THE ONE THAT MATTERS. Two claimed teams is ambiguous, and "take the first" would attribute
   * a window to a team the caller may not be trading from. There is no correct row to pick.
   */
  it('refuses ambiguity instead of taking the first row', async () => {
    const { prisma } = fakePrisma({
      leagueTeams: [{ externalId: '7', isOrphan: false }, { externalId: '9', isOrphan: false }],
    })
    const r = await resolveRequestingTeam(prisma, 'l1', 'user-1')
    expect(r).toEqual({ ok: false, gap: WINDOW_GAP_TEAM_AMBIGUOUS })
    // Explicitly NOT the first row.
    expect(JSON.stringify(r)).not.toContain('"7"')
  })

  it('refuses a CLAIMED row that is also flagged vacant, because that is data contradicting itself', async () => {
    const { prisma } = fakePrisma({ leagueTeams: [{ externalId: '7', isOrphan: true }] })
    expect(await resolveRequestingTeam(prisma, 'l1', 'user-1')).toEqual({ ok: false, gap: WINDOW_GAP_ARCHIVAL_UNPROVABLE })
  })

  it.each([[''], ['   ']])('refuses a blank externalId (%j)', async (externalId) => {
    const { prisma } = fakePrisma({ leagueTeams: [{ externalId, isOrphan: false }] })
    expect(await resolveRequestingTeam(prisma, 'l1', 'user-1')).toEqual({ ok: false, gap: WINDOW_GAP_TEAM_ID_MISSING })
  })

  it('scopes the lookup to the league AND the caller, and reads at most two rows', async () => {
    const { prisma, reads } = fakePrisma({ leagueTeams: [{ externalId: '7', isOrphan: false }] })
    await resolveRequestingTeam(prisma, 'l1', 'user-1')
    const call = reads.find(r => r.model === 'leagueTeam.findMany')!.args as {
      where: { leagueId: string; claimedByUserId: string }
      take: number
    }
    expect(call.where).toEqual({ leagueId: 'l1', claimedByUserId: 'user-1' })
    expect(call.take).toBe(2)
  })

  it('reports a database failure as a failure, not as "no team claimed"', async () => {
    const { prisma } = fakePrisma({ leagueTeamThrows: true })
    expect(await resolveRequestingTeam(prisma, 'l1', 'user-1')).toEqual({ ok: false, gap: WINDOW_GAP_TEAM_READ_FAILED })
  })
})

describe('a refusal carries evidence and reads none', () => {
  const refusalShape = (d: Awaited<ReturnType<typeof resolveRedraftTeamWindow>>, gap: string) => {
    expect(d.state).toBe('refused')
    expect(d.status).toBeNull()
    expect(d.observed).toBeNull()
    expect(d.teamFit).toEqual(NEUTRAL_TEAM_FIT)
    expect(d.gaps).toContain(gap)
  }

  it('refuses a pre-season period without touching identity or evidence', async () => {
    const { prisma, reads } = fakePrisma()
    const d = await resolveRedraftTeamWindow({ ...base, week: 0, prisma })
    refusalShape(d, WINDOW_GAP_PERIOD_UNRESOLVED)
    // Nothing at all was read: the period check is first for exactly this reason.
    expect(reads).toEqual([])
  })

  it('refuses a missing league before reading any team', async () => {
    const { prisma, reads } = fakePrisma({ league: null })
    const d = await resolveRedraftTeamWindow({ ...base, prisma })
    refusalShape(d, WINDOW_GAP_LEAGUE_MISSING)
    expect(reads.map(r => r.model)).toEqual(['league.findUnique'])
  })

  it('refuses an unresolvable identity WITHOUT reading matchups, forecast, dynasty or injuries', async () => {
    const { prisma, reads } = fakePrisma({ leagueTeams: [] })
    const d = await resolveRedraftTeamWindow({ ...base, prisma })
    refusalShape(d, WINDOW_GAP_TEAM_NOT_CLAIMED)
    const models = reads.map(r => r.model)
    expect(models).toContain('leagueTeam.findMany')
    for (const forbidden of [
      'weeklyMatchup.findMany', 'seasonForecastSnapshot.findFirst',
      'dynastyProjectionSnapshot.findFirst', 'sportsPlayer.findMany',
    ]) {
      expect(models).not.toContain(forbidden)
    }
  })

  /*
   * ⚠ THE ECHOED IDENTITY MUST NOT CARRY THE ROSTER ID. `teamId` is null on a refusal because no
   * canonical team was established; putting the RedraftRoster id there would state that a
   * LeagueTeam was identified when none was, in the one field an operator reads to find out.
   */
  it('echoes the scope it could describe and leaves teamId null', async () => {
    const { prisma } = fakePrisma({ leagueTeams: [] })
    const d = await resolveRedraftTeamWindow({ ...base, prisma })
    expect(d.identity).toEqual({
      leagueId: 'af-league-uuid', season: 2026, week: 6,
      teamId: null, teamName: null, managerName: null,
    })
    expect(JSON.stringify(d.identity)).not.toContain('redraft-roster-cuid')
  })

  it('does not add the invalid-scope gap — the scope was fine, the identity was not', async () => {
    const { prisma } = fakePrisma({ leagueTeams: [] })
    const d = await resolveRedraftTeamWindow({ ...base, prisma })
    expect(d.gaps).not.toContain('window_scope_invalid')
  })
})

describe('a resolved identity reaches the port in the right namespaces', () => {
  it('passes LeagueTeam.externalId as scope.teamId and the PLATFORM id as platformLeagueId', async () => {
    const { prisma, reads } = fakePrisma({
      league: { platformLeagueId: 'sleeper-999' },
      leagueTeams: [{ externalId: '7', isOrphan: false }],
      rosterPlayers: [{ playerId: 'p1' }, { playerId: 'p2' }],
      schedule: [{ week: 4 }, { week: 5 }, { week: 6 }],
      leagueRosterPlayers: [
        { rosterId: 'redraft-roster-cuid', playerId: 'p1' },
        { rosterId: 'redraft-roster-cuid', playerId: 'p2' },
        { rosterId: 'other-roster', playerId: 'p3' },
      ],
      projections: [
        { playerId: 'p1', rosProjection: 200, rosWeeksRemaining: 11, computedAt: new Date('2026-10-01T00:00:00Z') },
        { playerId: 'p2', rosProjection: 150, rosWeeksRemaining: 11, computedAt: new Date('2026-10-01T00:00:00Z') },
        { playerId: 'p3', rosProjection: 300, rosWeeksRemaining: 11, computedAt: new Date('2026-10-01T00:00:00Z') },
      ],
    })
    await resolveRedraftTeamWindow({ ...base, prisma })

    /*
     * 🛑 THE NAMESPACE ASSERTION THIS WHOLE FILE EXISTS FOR. WeeklyMatchup.leagueId holds the
     * PLATFORM league id; passing the AllFantasy uuid there returns zero rows and reads as a team
     * that has never played, rather than as an error.
     */
    const matchup = reads.find(r => r.model === 'weeklyMatchup.findMany')!.args as { where: { leagueId: string } }
    expect(matchup.where.leagueId).toBe('sleeper-999')
    expect(matchup.where.leagueId).not.toBe('af-league-uuid')

    /*
     * 🛑 AND THE FORECAST IS KEYED THE SAME WAY. This assertion previously read
     * `.toBe('af-league-uuid')`, under the comment "the AllFantasy uuid is what keys the
     * forecast" — a belief written down in two test files and never checked against a row.
     *
     * `season_forecast_snapshots.leagueId` holds the PLATFORM id, and every writer is forced to:
     * the forecast engine resolves its context from `rankings_snapshots`, keyed by the id
     * `computeLeagueRankingsV2` hands to `getLeagueInfo()` — a live Sleeper call that a uuid
     * cannot satisfy. Measured in production 2026-09-12: 40 forecast rows and 704 rankings rows,
     * ZERO uuid-shaped, and the live window refused with `season_forecast_missing` over rows
     * sitting in the table.
     *
     * ⚠ `dynasty` is the exception and stays on the uuid — its writer resolves the route param
     * with `resolveLeagueByAnyId` and persists `league.id`. The namespaces genuinely differ per
     * table; do not unify them.
     */
    const forecast = reads.find(r => r.model === 'seasonForecastSnapshot.findFirst')!.args as { where: { leagueId: string } }
    expect(forecast.where.leagueId).toBe('sleeper-999')
    expect(forecast.where.leagueId).not.toBe('af-league-uuid')

    // The injury read is scoped by sport, because externalId is not unique across sports.
    const players = reads.find(r => r.model === 'sportsPlayer.findMany')!.args as { where: { sport: string } }
    expect(players.where.sport).toBe('NFL')
  })

  /*
   * 🛑 THE ROSTER'S IDS ARE SLEEPER IDS, AND `SportsPlayer` KEEPS THOSE IN `sleeperId`.
   *
   * Matching them against `externalId` returned OTHER PLAYERS: measured in production, sleeper-
   * source rows have zero numeric `externalId`s, while the numeric `externalId` space belongs to
   * rolling_insights (ids 1..10,188, inside Sleeper's range). Eight of eight sampled matches were
   * the wrong person — roster 9225 is Tank Bigsby and matched "Mitch Van Vooren" (INACT). Across
   * 1,067 rosters the correct join moves average coverage 0.147 -> 0.983.
   */
  it('matches a sleeper league on sleeperId and the sleeper source, never externalId', async () => {
    const { prisma, reads } = fakePrisma({
      leagueTeams: [{ externalId: '7', isOrphan: false }],
      rosterPlayers: [{ playerId: '9225' }, { playerId: '8130' }],
      schedule: [{ week: 6 }],
    })
    await resolveRedraftTeamWindow({ ...base, prisma })
    const players = reads.find(r => r.model === 'sportsPlayer.findMany')!.args as {
      where: { sport: string; sleeperId?: { in: string[] }; externalId?: unknown; source?: string }
    }
    expect(players.where.sport).toBe('NFL')
    expect(players.where.sleeperId).toEqual({ in: ['9225', '8130'] })
    expect(players.where.source).toBe('sleeper')
    // The column that returned other people's players must not be used for a sleeper league.
    expect(players.where.externalId).toBeUndefined()
  })

  /*
   * ⚠ THE OTHER DIRECTION. A non-sleeper league's roster ids are NOT sleeper ids, so they keep the
   * previous `externalId` behaviour rather than being matched against a column that cannot hold
   * them. This is why the platform is threaded through rather than the join being switched
   * unconditionally.
   */
  it('leaves a non-sleeper league on externalId', async () => {
    const { prisma, reads } = fakePrisma({
      league: { platformLeagueId: 'espn-1', platform: 'espn' },
      leagueTeams: [{ externalId: '7', isOrphan: false }],
      rosterPlayers: [{ playerId: 'abc' }],
      schedule: [{ week: 6 }],
    })
    await resolveRedraftTeamWindow({ ...base, prisma })
    const players = reads.find(r => r.model === 'sportsPlayer.findMany')!.args as {
      where: { externalId?: { in: string[] }; sleeperId?: unknown; source?: unknown }
    }
    expect(players.where.externalId).toEqual({ in: ['abc'] })
    expect(players.where.sleeperId).toBeUndefined()
    expect(players.where.source).toBeUndefined()
  })

  it('reads the injury roster from the PROPOSER roster the route validated', async () => {
    const { prisma, reads } = fakePrisma({
      leagueTeams: [{ externalId: '7', isOrphan: false }],
      rosterPlayers: [{ playerId: 'p1' }],
      schedule: [{ week: 6 }],
    })
    await resolveRedraftTeamWindow({ ...base, prisma })
    const call = reads.find(r => r.model === 'redraftRosterPlayer.findMany')!.args as { where: { rosterId: string } }
    expect(call.where.rosterId).toBe('redraft-roster-cuid')
  })

  it('refuses rather than throwing when the evidence reads fail', async () => {
    const { prisma } = fakePrisma({ leagueTeams: [{ externalId: '7', isOrphan: false }] })
    // No matchups, no forecast, no dynasty, no injuries — the port returns nulls throughout.
    const d = await resolveRedraftTeamWindow({ ...base, prisma })
    expect(d.state).toBe('refused')
    expect(d.status).toBeNull()
    expect(d.teamFit).toEqual(NEUTRAL_TEAM_FIT)
    // It got far enough to identify the team, so the echo carries it.
    expect(d.identity.teamId).toBe('7')
  })
})

// ── REST-OF-SEASON PROJECTIONS ARE KEYED ON THE CANONICAL IDENTITY ───────────────────────────────

type RosEvidence = { share: number; playersCovered: number; rosterSize: number; teamsCovered: number } | null
const rosOf = (d: unknown) => (d as { evidence?: { restOfSeason?: RosEvidence } }).evidence?.restOfSeason ?? null

describe('rest-of-season projections are reached through PlayerIdentityMap on a sleeper league', () => {
  const identityMap = [
    { id: 'canon-a', sleeperId: '9225' },
    { id: 'canon-b', sleeperId: '8130' },
    { id: 'canon-c', sleeperId: '7528' },
  ]
  const at = new Date('2026-10-01T00:00:00Z')
  const projections = [
    { playerId: 'canon-a', rosProjection: 200, rosWeeksRemaining: 11, computedAt: at },
    { playerId: 'canon-b', rosProjection: 150, rosWeeksRemaining: 11, computedAt: at },
    { playerId: 'canon-c', rosProjection: 300, rosWeeksRemaining: 11, computedAt: at },
    // A DECOY keyed by a RAW sleeper id. A loader that looks projections up by roster id finds this
    // 9,999-point row, so the wrong join produces a wrong NUMBER rather than merely a missing one.
    { playerId: '9225', rosProjection: 9999, rosWeeksRemaining: 11, computedAt: at },
  ]

  /*
   * THE REGRESSION. NFL `AFProjectionSnapshot.playerId` is `PlayerIdentityMap.id` (1,578 of 1,578
   * measured), and the roster holds Sleeper ids, so the direct lookup matched nothing for every
   * Sleeper league and the window refused with `rest_of_season_projection_missing`.
   */
  it('crosswalks sleeper ids to canonical ids, then reads projections by canonical id and sport', async () => {
    const { prisma, reads } = fakePrisma({
      leagueTeams: [{ externalId: '7', isOrphan: false }],
      rosterPlayers: [{ playerId: '9225' }, { playerId: '8130' }],
      schedule: [{ week: 4 }, { week: 5 }, { week: 6 }],
      leagueRosterPlayers: [
        { rosterId: 'redraft-roster-cuid', playerId: '9225' },
        { rosterId: 'redraft-roster-cuid', playerId: '8130' },
        { rosterId: 'other-roster', playerId: '7528' },
      ],
      identityMap, projections,
    })
    const d = await resolveRedraftTeamWindow({ ...base, prisma })

    const map = reads.find(r => r.model === 'playerIdentityMap.findMany')!.args as { where: { sleeperId: { in: string[] }; sport: string } }
    expect(new Set(map.where.sleeperId.in)).toEqual(new Set(['9225', '8130', '7528']))
    expect(map.where.sport).toBe('NFL')

    const proj = reads.find(r => r.model === 'aFProjectionSnapshot.findMany')!.args as { where: { playerId: { in: string[] }; sport: string } }
    expect(new Set(proj.where.playerId.in)).toEqual(new Set(['canon-a', 'canon-b', 'canon-c']))
    expect(proj.where.playerId.in).not.toContain('9225')
    expect(proj.where.sport).toBe('NFL')

    const ros = rosOf(d)
    expect(ros).not.toBeNull()
    expect(ros!.share).toBeCloseTo(350 / 650, 10)
    expect(ros!.playersCovered).toBe(2)
    expect(ros!.rosterSize).toBe(2)
    expect(ros!.teamsCovered).toBe(2)
  })

  /*
   * A TEAM DEFENSE CAN NEVER HAVE A PLAYER PROJECTION, so it must not count against coverage.
   * Measured: all 26 non-numeric rostered Sleeper ids are team abbreviations.
   */
  it('does not count a sleeper team-defense slot in rosterSize', async () => {
    const { prisma } = fakePrisma({
      leagueTeams: [{ externalId: '7', isOrphan: false }],
      rosterPlayers: [{ playerId: '9225' }, { playerId: '8130' }, { playerId: 'KC' }],
      schedule: [{ week: 4 }, { week: 5 }, { week: 6 }],
      leagueRosterPlayers: [
        { rosterId: 'redraft-roster-cuid', playerId: '9225' },
        { rosterId: 'redraft-roster-cuid', playerId: '8130' },
        { rosterId: 'redraft-roster-cuid', playerId: 'KC' },
        { rosterId: 'other-roster', playerId: '7528' },
      ],
      identityMap, projections,
    })
    const ros = rosOf(await resolveRedraftTeamWindow({ ...base, prisma }))
    expect(ros).not.toBeNull()
    expect(ros!.rosterSize).toBe(2)
    expect(ros!.playersCovered).toBe(2)
  })

  /*
   * THE OTHER DIRECTION, AND A PIN RATHER THAN EVIDENCE: a non-sleeper league's roster ids are not
   * sleeper ids, so they keep the direct lookup. This passes against the pre-fix loader too; the
   * platform-gate mutation is what makes it mean something.
   */
  it('leaves a non-sleeper league on the direct lookup, never touching the identity map', async () => {
    const { prisma, reads } = fakePrisma({
      league: { platformLeagueId: 'espn-1', platform: 'espn' },
      leagueTeams: [{ externalId: '7', isOrphan: false }],
      rosterPlayers: [{ playerId: 'e1' }, { playerId: 'e2' }],
      schedule: [{ week: 4 }, { week: 5 }, { week: 6 }],
      leagueRosterPlayers: [
        { rosterId: 'redraft-roster-cuid', playerId: 'e1' },
        { rosterId: 'redraft-roster-cuid', playerId: 'e2' },
        { rosterId: 'other-roster', playerId: 'e3' },
      ],
      identityMap: [{ id: 'canon-x', sleeperId: 'e1' }],
      projections: [
        { playerId: 'e1', rosProjection: 100, rosWeeksRemaining: 11, computedAt: at },
        { playerId: 'e2', rosProjection: 100, rosWeeksRemaining: 11, computedAt: at },
        { playerId: 'e3', rosProjection: 200, rosWeeksRemaining: 11, computedAt: at },
      ],
    })
    const d = await resolveRedraftTeamWindow({ ...base, prisma })
    expect(reads.map(r => r.model)).not.toContain('playerIdentityMap.findMany')
    const proj = reads.find(r => r.model === 'aFProjectionSnapshot.findMany')!.args as { where: { playerId: { in: string[] } } }
    expect(new Set(proj.where.playerId.in)).toEqual(new Set(['e1', 'e2', 'e3']))
    expect(rosOf(d)!.share).toBeCloseTo(200 / 400, 10)
  })
})
