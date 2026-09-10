import { describe, expect, it } from 'vitest'
import {
  resolveRedraftTeamWindow, resolveRequestingTeam,
  WINDOW_GAP_ADAPTER_FAILED, WINDOW_GAP_LEAGUE_MISSING, WINDOW_GAP_PERIOD_UNRESOLVED,
  WINDOW_GAP_TEAM_AMBIGUOUS, WINDOW_GAP_TEAM_ARCHIVED, WINDOW_GAP_TEAM_ID_MISSING,
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
  rosterPlayers?: Array<{ playerId: string | null }>
} = {}) {
  const reads: Read[] = []
  const log = (model: string) => (args: unknown) => { reads.push({ model, args }); return args }
  const prisma = {
    league: {
      findUnique: async (args: unknown) => {
        log('league.findUnique')(args)
        return over.league === undefined ? { platformLeagueId: 'sleeper-1' } : over.league
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
       * catch correctly reported as `window_adapter_read_failed`, i.e. the test double's hole
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
        log('redraftRosterPlayer.findMany')(args)
        return over.rosterPlayers ?? []
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
  sport: 'NFL', season: 2026, week: 6,
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

  it('refuses an archived (orphaned) team even though its matchups would resolve', async () => {
    const { prisma } = fakePrisma({ leagueTeams: [{ externalId: '7', isOrphan: true }] })
    expect(await resolveRequestingTeam(prisma, 'l1', 'user-1')).toEqual({ ok: false, gap: WINDOW_GAP_TEAM_ARCHIVED })
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
    expect(await resolveRequestingTeam(prisma, 'l1', 'user-1')).toEqual({ ok: false, gap: WINDOW_GAP_ADAPTER_FAILED })
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

    // ...while the AllFantasy uuid is what keys the forecast.
    const forecast = reads.find(r => r.model === 'seasonForecastSnapshot.findFirst')!.args as { where: { leagueId: string } }
    expect(forecast.where.leagueId).toBe('af-league-uuid')

    // The injury read is scoped by sport, because externalId is not unique across sports.
    const players = reads.find(r => r.model === 'sportsPlayer.findMany')!.args as { where: { sport: string } }
    expect(players.where.sport).toBe('NFL')
  })

  it('reads the injury roster from the PROPOSER roster the route validated', async () => {
    const { prisma, reads } = fakePrisma({
      leagueTeams: [{ externalId: '7', isOrphan: false }],
      rosterPlayers: [{ playerId: 'p1' }],
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
