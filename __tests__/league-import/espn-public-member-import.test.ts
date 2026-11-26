// @vitest-environment node
/**
 * Public ESPN league, no cookies: the importer picks their team. What makes that safe is tested here:
 * the league is owned by the system account (never the importer), the claim is UNCONFIRMED, a
 * commissioner's team cannot be picked, a held team is never taken, and a proven member later wins.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Team = {
  id: string
  leagueId: string
  externalId: string
  claimedByUserId: string | null
  isCommissioner: boolean
  isCoCommissioner: boolean
  platformUserId: string | null
  isOrphan?: boolean
}
type Claim = {
  id: string
  leagueId: string
  afUserId: string
  teamExternalId: string
  platformUserId: string | null
  isConfirmed: boolean
}
type LeagueRow = { id: string; name: string; sport: string; userId: string; platform: string; platformLeagueId: string; season: number }

const db = vi.hoisted(() => ({
  leagues: [] as LeagueRow[],
  teams: [] as Team[],
  claims: [] as Claim[],
  seq: 0,
}))

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    const actual = row[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const cond = v as Record<string, unknown>
      if ('not' in cond) return actual !== cond.not
      if ('in' in cond) return (cond.in as unknown[]).includes(actual)
    }
    return actual === v
  })
}

vi.mock('@/lib/prisma', () => {
  const leagueTeam = {
    findFirst: vi.fn(async ({ where }: any) => db.teams.find((t) => matches(t, where)) ?? null),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const hit = db.teams.filter((t) => matches(t, where))
      hit.forEach((t) => Object.assign(t, data))
      return { count: hit.length }
    }),
  }
  const leagueManagerClaim = {
    findFirst: vi.fn(async ({ where }: any) => db.claims.find((c) => matches(c, where)) ?? null),
    findMany: vi.fn(async ({ where }: any) => db.claims.filter((c) => matches(c, where))),
    create: vi.fn(async ({ data }: any) => {
      if (db.claims.some((c) => c.leagueId === data.leagueId && (c.afUserId === data.afUserId || c.teamExternalId === data.teamExternalId))) {
        throw Object.assign(new Error('unique'), { code: 'P2002' })
      }
      const row = { id: `c${++db.seq}`, ...data }
      db.claims.push(row)
      return row
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = db.claims.find((c) => c.id === where.id)!
      Object.assign(row, data)
      return row
    }),
    delete: vi.fn(async ({ where }: any) => {
      db.claims = db.claims.filter((c) => c.id !== where.id)
      return {}
    }),
  }
  const prisma = {
    league: {
      findMany: vi.fn(async ({ where }: any) => db.leagues.filter((l) => matches(l, where))),
      findFirst: vi.fn(async ({ where }: any) => db.leagues.find((l) => matches(l, where)) ?? null),
    },
    leagueTeam,
    leagueManagerClaim,
    $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
  }
  return { prisma }
})
vi.mock('@/lib/rank/calculateRank', () => ({ calculateAndSaveRank: vi.fn(async () => undefined) }))
vi.mock('@/lib/league-import/systemLeagueOwner', () => ({
  ensureSystemLeagueOwner: vi.fn(async () => 'SYSTEM'),
  isSystemLeagueOwner: (id: string | null | undefined) => id === 'SYSTEM',
}))

import {
  claimTeamUnconfirmed,
  importPublicEspnLeagueAsMember,
  parseEspnLeagueRunBy,
  stripCommissionerFlagsFromUnprovenClaims,
} from '@/lib/league-import/espn/espnPublicMemberImport'
import { confirmOrTakeOverUnprovenClaim } from '@/lib/league-import/ImportedLeagueCommitService'

const NORMALIZED: any = {
  source: { source_league_id: '777' },
  league: { season: 2026, sport: 'NFL' },
  rosters: [
    { source_team_id: '1', source_manager_id: '{M1}', is_commissioner: true },
    { source_team_id: '2', source_manager_id: '{M2}' },
    { source_team_id: '3', source_manager_id: '{M3}', is_co_commissioner: true },
    { source_team_id: '4', source_manager_id: '{M4}' },
  ],
}

function seedTeams(leagueId: string) {
  for (const r of NORMALIZED.rosters) {
    db.teams.push({
      id: `${leagueId}-t${r.source_team_id}`,
      leagueId,
      externalId: r.source_team_id,
      claimedByUserId: null,
      isCommissioner: r.is_commissioner === true,
      isCoCommissioner: r.is_co_commissioner === true,
      platformUserId: r.source_manager_id,
    })
  }
}

const persistAsOwner = vi.fn(async (ownerUserId: string) => {
  const row: LeagueRow = { id: 'L1', name: 'Pub League', sport: 'NFL', userId: ownerUserId, platform: 'espn', platformLeagueId: '777', season: 2026 }
  db.leagues.push(row)
  seedTeams('L1')
  return { league: { id: row.id, name: row.name, sport: row.sport }, historicalBackfill: null, existed: false, joinedExisting: false } as any
})

beforeEach(() => {
  db.leagues = []
  db.teams = []
  db.claims = []
  db.seq = 0
  persistAsOwner.mockClear()
})

describe('parseEspnLeagueRunBy', () => {
  it('accepts the three answers and nothing else', () => {
    expect(parseEspnLeagueRunBy('espn')).toBe('espn')
    expect(parseEspnLeagueRunBy('member')).toBe('member')
    expect(parseEspnLeagueRunBy('me')).toBe('me')
    expect(parseEspnLeagueRunBy('commissioner')).toBeNull()
    expect(parseEspnLeagueRunBy(undefined)).toBeNull()
  })
})

describe('importPublicEspnLeagueAsMember', () => {
  it('creates the league owned by the SYSTEM account and claims the picked team unconfirmed', async () => {
    const res = await importPublicEspnLeagueAsMember({ userId: 'alice', normalized: NORMALIZED, claimSourceTeamId: '2', persistAsOwner })
    expect(res).toMatchObject({ ok: true, joinedExisting: false })
    expect(persistAsOwner).toHaveBeenCalledWith('SYSTEM')
    expect(db.leagues[0].userId).toBe('SYSTEM')
    expect(db.teams.find((t) => t.externalId === '2')!.claimedByUserId).toBe('alice')
    expect(db.claims).toEqual([expect.objectContaining({ afUserId: 'alice', teamExternalId: '2', isConfirmed: false })])
  })

  it('a second person joins the same league row instead of creating another', async () => {
    await importPublicEspnLeagueAsMember({ userId: 'alice', normalized: NORMALIZED, claimSourceTeamId: '2', persistAsOwner })
    const res = await importPublicEspnLeagueAsMember({ userId: 'bob', normalized: NORMALIZED, claimSourceTeamId: '4', persistAsOwner })
    expect(res).toMatchObject({ ok: true, joinedExisting: true })
    expect(persistAsOwner).toHaveBeenCalledTimes(1)
    expect(db.teams.find((t) => t.externalId === '4')!.claimedByUserId).toBe('bob')
  })

  it("refuses the commissioner's and co-commissioner's teams without proof", async () => {
    for (const id of ['1', '3']) {
      const res = await importPublicEspnLeagueAsMember({ userId: 'mallory', normalized: NORMALIZED, claimSourceTeamId: id, persistAsOwner })
      expect(res).toMatchObject({ ok: false, code: 'COMMISSIONER_TEAM_NEEDS_PROOF' })
    }
    expect(db.claims).toEqual([])
  })

  it('never takes a team someone already holds', async () => {
    await importPublicEspnLeagueAsMember({ userId: 'alice', normalized: NORMALIZED, claimSourceTeamId: '2', persistAsOwner })
    const res = await importPublicEspnLeagueAsMember({ userId: 'mallory', normalized: NORMALIZED, claimSourceTeamId: '2', persistAsOwner })
    expect(res).toMatchObject({ ok: false, code: 'TEAM_ALREADY_CLAIMED' })
    expect(db.teams.find((t) => t.externalId === '2')!.claimedByUserId).toBe('alice')
  })

  it('does not join a league a person already runs on AllFantasy — that is what invites are for', async () => {
    db.leagues.push({ id: 'L9', name: 'Run by Carol', sport: 'NFL', userId: 'carol', platform: 'espn', platformLeagueId: '777', season: 2026 })
    const res = await importPublicEspnLeagueAsMember({ userId: 'bob', normalized: NORMALIZED, claimSourceTeamId: '4', persistAsOwner })
    expect(res).toMatchObject({ ok: false, code: 'LEAGUE_RUN_BY_COMMISSIONER', status: 409 })
    expect(persistAsOwner).not.toHaveBeenCalled()
  })

  it('rejects a team that is not in the league', async () => {
    const res = await importPublicEspnLeagueAsMember({ userId: 'alice', normalized: NORMALIZED, claimSourceTeamId: '99', persistAsOwner })
    expect(res).toMatchObject({ ok: false, code: 'CLAIM_TEAM_NOT_IN_LEAGUE' })
  })
})

describe('importPublicEspnLeagueAsMember — pasted Yahoo league', () => {
  const YAHOO: any = {
    source: { source_league_id: 'nfl.l.424242' },
    league: { season: 2026, sport: 'NFL' },
    rosters: [
      { source_team_id: 'nfl.l.424242.t.1', source_manager_id: 'nfl.l.424242.t.1' },
      { source_team_id: 'nfl.l.424242.t.2', source_manager_id: 'nfl.l.424242.t.2' },
    ],
  }
  const persistYahoo = vi.fn(async (ownerUserId: string, _opts?: { allowUpdateExisting: boolean }) => {
    if (!db.leagues.some((l) => l.id === 'LY')) {
      db.leagues.push({ id: 'LY', name: 'Moonbase', sport: 'NFL', userId: ownerUserId, platform: 'yahoo', platformLeagueId: 'nfl.l.424242', season: 2026 })
      for (const r of YAHOO.rosters) {
        db.teams.push({ id: `LY-${r.source_team_id}`, leagueId: 'LY', externalId: r.source_team_id, claimedByUserId: null, isCommissioner: false, isCoCommissioner: false, platformUserId: r.source_manager_id })
      }
    }
    return { league: { id: 'LY', name: 'Moonbase', sport: 'NFL' }, historicalBackfill: null, existed: false, joinedExisting: false } as any
  })
  beforeEach(() => persistYahoo.mockClear())
  const run = (userId: string, team: string, extra: Record<string, unknown> = {}) =>
    importPublicEspnLeagueAsMember({ userId, normalized: YAHOO, claimSourceTeamId: team, platform: 'yahoo', persistAsOwner: persistYahoo, ...extra })

  it('owns the league by the SYSTEM account, keyed on platform yahoo, claim unconfirmed, no C', async () => {
    // An ESPN system row with the same id is a different league and must not be joined.
    db.leagues.push({ id: 'LE', name: 'x', sport: 'NFL', userId: 'SYSTEM', platform: 'espn', platformLeagueId: 'nfl.l.424242', season: 2026 })
    const res = await run('alice', 'nfl.l.424242.t.2')
    expect(res).toMatchObject({ ok: true, joinedExisting: false, league: { id: 'LY' } })
    expect(persistYahoo).toHaveBeenCalledWith('SYSTEM')
    const team = db.teams.find((t) => t.id === 'LY-nfl.l.424242.t.2')!
    expect(team.claimedByUserId).toBe('alice')
    expect(team.isCommissioner).toBe(false)
    expect(db.claims).toEqual([expect.objectContaining({ afUserId: 'alice', isConfirmed: false })])
  })

  it('says Yahoo, not ESPN, when a team is taken', async () => {
    await run('alice', 'nfl.l.424242.t.2')
    const res = await run('bob', 'nfl.l.424242.t.2')
    expect(res).toMatchObject({ ok: false, code: 'TEAM_ALREADY_CLAIMED' })
    expect((res as { error: string }).error).not.toContain('ESPN')
  })

  it('refresh re-persists the system row only for a member who already holds a team in it', async () => {
    await run('alice', 'nfl.l.424242.t.2')
    persistYahoo.mockClear()
    // A newcomer asking to "update" just joins — they never rewrite the shared row.
    expect(await run('bob', 'nfl.l.424242.t.1', { refreshExisting: true })).toMatchObject({ ok: true, joinedExisting: true })
    expect(persistYahoo).not.toHaveBeenCalled()
    // The holder's update reaches the persist with allowUpdateExisting, as the system owner.
    expect(await run('alice', 'nfl.l.424242.t.2', { refreshExisting: true })).toMatchObject({ ok: true, existed: true })
    expect(persistYahoo).toHaveBeenCalledWith('SYSTEM', { allowUpdateExisting: true })
  })

  it('a member "update" of a league they run as commissioner is sent to the commissioner choice', async () => {
    db.leagues.push({ id: 'LC', name: 'Mine', sport: 'NFL', userId: 'alice', platform: 'yahoo', platformLeagueId: 'nfl.l.424242', season: 2026 })
    expect(await run('alice', 'nfl.l.424242.t.2', { refreshExisting: true })).toMatchObject({ ok: false, code: 'LEAGUE_IS_YOURS' })
    expect(await run('alice', 'nfl.l.424242.t.2')).toMatchObject({ ok: true, existed: true })
  })
})

describe('claimTeamUnconfirmed', () => {
  it('gives one person one team per league', async () => {
    seedTeams('L1')
    expect(await claimTeamUnconfirmed({ leagueId: 'L1', userId: 'alice', teamExternalId: '2' })).toMatchObject({ ok: true })
    expect(await claimTeamUnconfirmed({ leagueId: 'L1', userId: 'alice', teamExternalId: '4' })).toMatchObject({ ok: false, code: 'ALREADY_HAVE_TEAM' })
    expect(await claimTeamUnconfirmed({ leagueId: 'L1', userId: 'alice', teamExternalId: '2' })).toEqual({ ok: true, alreadyHeld: true })
  })
})

describe('stripCommissionerFlagsFromUnprovenClaims', () => {
  it('clears the head-commissioner flag from a team held by an unconfirmed claim, and only that', async () => {
    seedTeams('L1')
    await claimTeamUnconfirmed({ leagueId: 'L1', userId: 'alice', teamExternalId: '2' })
    // ESPN's flags move after the claim: alice's team is now flagged commissioner.
    db.teams.find((t) => t.externalId === '2')!.isCommissioner = true
    expect(await stripCommissionerFlagsFromUnprovenClaims('L1')).toBe(1)
    expect(db.teams.find((t) => t.externalId === '2')!.isCommissioner).toBe(false)
    // The real commissioner's unclaimed team keeps its flag.
    expect(db.teams.find((t) => t.externalId === '1')!.isCommissioner).toBe(true)
  })
})

describe('confirmOrTakeOverUnprovenClaim (proof beats a pick)', () => {
  it('moves a team held by someone else\'s unconfirmed claim to the proven member', async () => {
    seedTeams('L1')
    await claimTeamUnconfirmed({ leagueId: 'L1', userId: 'mallory', teamExternalId: '2' })
    const res = await confirmOrTakeOverUnprovenClaim({ leagueId: 'L1', userId: 'bob', sourceManagerId: '{M2}' })
    expect(res).toBe('took-over')
    expect(db.teams.find((t) => t.externalId === '2')!.claimedByUserId).toBe('bob')
    expect(db.claims).toEqual([expect.objectContaining({ afUserId: 'bob', teamExternalId: '2', isConfirmed: true })])
  })

  it('upgrades the caller\'s own unconfirmed pick to confirmed', async () => {
    seedTeams('L1')
    await claimTeamUnconfirmed({ leagueId: 'L1', userId: 'bob', teamExternalId: '2' })
    expect(await confirmOrTakeOverUnprovenClaim({ leagueId: 'L1', userId: 'bob', sourceManagerId: '{M2}' })).toBe('confirmed-own')
    expect(db.claims[0].isConfirmed).toBe(true)
  })

  it('releases the proven member\'s other unconfirmed pick so they keep one team', async () => {
    seedTeams('L1')
    await claimTeamUnconfirmed({ leagueId: 'L1', userId: 'bob', teamExternalId: '4' })
    await claimTeamUnconfirmed({ leagueId: 'L1', userId: 'mallory', teamExternalId: '2' })
    expect(await confirmOrTakeOverUnprovenClaim({ leagueId: 'L1', userId: 'bob', sourceManagerId: '{M2}' })).toBe('took-over')
    expect(db.teams.find((t) => t.externalId === '4')!.claimedByUserId).toBeNull()
    expect(db.teams.find((t) => t.externalId === '2')!.claimedByUserId).toBe('bob')
  })

  it('never displaces a CONFIRMED holder', async () => {
    seedTeams('L1')
    db.teams.find((t) => t.externalId === '2')!.claimedByUserId = 'carol'
    db.claims.push({ id: 'cx', leagueId: 'L1', afUserId: 'carol', teamExternalId: '2', platformUserId: '{M2}', isConfirmed: true })
    expect(await confirmOrTakeOverUnprovenClaim({ leagueId: 'L1', userId: 'bob', sourceManagerId: '{M2}' })).toBeNull()
    expect(db.teams.find((t) => t.externalId === '2')!.claimedByUserId).toBe('carol')
  })
})
