/**
 * @vitest-environment node
 *
 * 🛑 A FLEAFLICKER IMPORT CLAIMED NO TEAM, SO THE LEAGUE WAS INVISIBLE.
 *
 * Fleaflicker publishes every team's owner but never says which one is the caller — there is no
 * login, no cookie, no "viewer" field — and the commissioner gate therefore resolves no
 * `sourceManagerId`. Every LeagueTeam landed with `claimedByUserId` null, and Portfolio lists only
 * leagues where the viewer holds a claimed team.
 *
 * The importer now picks their team on the preview screen. This drives the REAL
 * `bootstrapLeagueFromNormalizedImport` against an in-memory `leagueTeam` / `rosters` table and
 * asserts on the row that ends up written: the chosen team, and only the chosen team, carries the
 * importer's id — and a team already held by someone else is never taken.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Team = {
  id: string
  leagueId: string
  externalId: string
  claimedByUserId: string | null
  platformUserId: string | null
}
type Row = { id: string; leagueId: string; platformUserId: string; playerData: any }

const db = vi.hoisted(() => ({ teams: [] as Team[], rosters: [] as Row[], seq: 0 }))

function lazy<T>(fn: () => T): PromiseLike<T> {
  let p: Promise<T> | null = null
  return { then: (res, rej) => (p ??= Promise.resolve().then(fn)).then(res, rej) }
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: {
      findMany: ({ where }: any) => lazy(() => db.rosters.filter((r) => r.leagueId === where.leagueId).map((r) => ({ ...r }))),
      update: ({ where, data }: any) =>
        lazy(() => {
          const r = db.rosters.find((x) => x.id === where.id)!
          Object.assign(r, data)
          return { ...r }
        }),
      create: ({ data }: any) =>
        lazy(() => {
          const r = { id: `r-${++db.seq}`, ...data }
          db.rosters.push(r)
          return { ...r }
        }),
    },
    leagueTeam: {
      findMany: ({ where }: any) => lazy(() => db.teams.filter((t) => t.leagueId === where.leagueId).map((t) => ({ ...t }))),
      upsert: ({ where, create, update }: any) =>
        lazy(() => {
          const key = where.leagueId_externalId
          const t = db.teams.find((x) => x.leagueId === key.leagueId && x.externalId === key.externalId)
          if (t) Object.assign(t, update)
          else db.teams.push({ id: `t-${key.externalId}`, claimedByUserId: null, platformUserId: null, ...create })
          return {}
        }),
    },
    appUser: { findMany: () => lazy(() => []) },
    userProfile: { findMany: () => lazy(() => []) },
    teamPerformance: { upsert: () => lazy(() => ({})) },
    $transaction: async (ops: PromiseLike<unknown>[]) => {
      const out = []
      for (const op of ops) out.push(await op)
      return out
    },
  },
}))

import { bootstrapLeagueFromImport } from '@/lib/league-import/LeagueCreationBootstrapService'

const L = 'league-flea'
const ME = 'af-user-me'

/* The adapter's real shape: owner id when there is one, the TEAM id when there is not. */
function fleaTeam(teamId: string, ownerId: string | null) {
  return {
    source_team_id: teamId,
    source_manager_id: ownerId ?? teamId,
    owner_name: ownerId ? `Owner ${ownerId}` : `Team ${teamId}`,
    team_name: `Team ${teamId}`,
    avatar_url: null,
    wins: 0,
    losses: 0,
    ties: 0,
    points_for: 0,
    player_ids: [`p-${teamId}`],
    starter_ids: [],
    reserve_ids: [],
    taxi_ids: [],
  }
}

function snapshot(rosters: unknown[]) {
  return {
    source: {
      source_provider: 'fleaflicker',
      source_league_id: '349505',
      source_season_id: '2026',
      import_batch_id: null,
      imported_at: '2026-09-25T00:00:00Z',
    },
    league: { season: 2026 },
    rosters,
    standings: [],
    schedule: [],
  } as any
}

const LEAGUE = [fleaTeam('1001', '55'), fleaTeam('1002', '77'), fleaTeam('1003', null)]
const claimOf = (teamId: string) => db.teams.find((t) => t.externalId === teamId)?.claimedByUserId ?? null

beforeEach(() => {
  db.teams = []
  db.rosters = []
  db.seq = 0
})

describe('🛑 the importer’s chosen Fleaflicker team ends up claimed', () => {
  it('claims the chosen team for the importer', async () => {
    await bootstrapLeagueFromImport(L, snapshot(LEAGUE), { userId: ME, sourceTeamId: '1002' })

    expect(claimOf('1002')).toBe(ME)
  })

  it('claims ONLY that team — every other manager stays unclaimed', async () => {
    await bootstrapLeagueFromImport(L, snapshot(LEAGUE), { userId: ME, sourceTeamId: '1002' })

    expect(claimOf('1001')).toBeNull()
    expect(claimOf('1003')).toBeNull()
  })

  it('works for an ownerless team, whose manager id IS its team id', async () => {
    await bootstrapLeagueFromImport(L, snapshot(LEAGUE), { userId: ME, sourceTeamId: '1003' })

    expect(claimOf('1003')).toBe(ME)
    expect(claimOf('1001')).toBeNull()
  })

  it('without a chosen team, nothing is claimed (the old behaviour)', async () => {
    await bootstrapLeagueFromImport(L, snapshot(LEAGUE), { userId: ME })

    expect(db.teams.every((t) => t.claimedByUserId === null)).toBe(true)
  })

  it('never takes a team another account already holds', async () => {
    db.teams.push({ id: 't-1002', leagueId: L, externalId: '1002', claimedByUserId: 'someone-else', platformUserId: '77' })

    await bootstrapLeagueFromImport(L, snapshot(LEAGUE), { userId: ME, sourceTeamId: '1002' })

    expect(claimOf('1002')).toBe('someone-else')
  })

  it('a re-import by the same person keeps their claim', async () => {
    await bootstrapLeagueFromImport(L, snapshot(LEAGUE), { userId: ME, sourceTeamId: '1002' })
    await bootstrapLeagueFromImport(L, snapshot(LEAGUE), { userId: ME, sourceTeamId: '1002' })

    expect(claimOf('1002')).toBe(ME)
  })

  it('the chosen team’s roster is keyed to the importer, like any claimed team', async () => {
    await bootstrapLeagueFromImport(L, snapshot(LEAGUE), { userId: ME, sourceTeamId: '1002' })

    const row = db.rosters.find((r) => r.playerData?.source_team_id === '1002')
    expect(row?.platformUserId).toBe(ME)
  })
})
