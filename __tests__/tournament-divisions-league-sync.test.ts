import { beforeEach, describe, expect, it, vi } from 'vitest'

type TL = { id: string; tournamentId: string; name: string; leagueNumber: number; leagueId: string | null; draftScheduledAt: Date | null }
type Team = { id: string; leagueId: string; claimedByUserId: string | null; isCommissioner: boolean; isCoCommissioner: boolean }

const { db, prismaMock, patch } = vi.hoisted(() => {
  const db = {
    shell: { id: 't1', format: 'divisions', commissionerId: 'owner' } as Record<string, unknown> | null,
    leagues: [] as TL[],
    sessions: new Map<string, string>(),
    draftDates: new Map<string, Date>(),
    grants: [] as Array<{ tournamentId: string; userId: string; canEditSettings: boolean; role?: string }>,
    appLeagues: new Map<string, { userId: string; settings: Record<string, unknown> }>(),
    teams: [] as Team[],
    audits: [] as Array<{ action: string; data: Record<string, unknown> }>,
    users: [] as Array<{ id: string; username: string }>,
    refuse: new Set<string>(),
  }
  const inFilter = (v: unknown, x: unknown) => !v || typeof v !== 'object' || !('in' in (v as object)) || (v as { in: unknown[] }).in.includes(x)
  const prismaMock: Record<string, unknown> = {
    tournamentShell: { findUnique: vi.fn(async () => (db.shell ? { ...db.shell } : null)) },
    tournamentLeague: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => db.leagues
        .filter(l => l.tournamentId === where.tournamentId)
        .filter(l => !where.draftScheduledAt || l.draftScheduledAt)
        .filter(l => !where.leagueId || l.leagueId)
        .filter(l => inFilter(where.id, l.id))
        .sort((a, b) => a.leagueNumber - b.leagueNumber).map(l => ({ ...l }))),
    },
    draftSession: { findFirst: vi.fn(async ({ where }: { where: { leagueId: string } }) => (db.sessions.has(where.leagueId) ? { status: db.sessions.get(where.leagueId) } : null)) },
    leagueSettings: { findUnique: vi.fn(async ({ where }: { where: { leagueId: string } }) => (db.draftDates.has(where.leagueId) ? { draftDateUtc: db.draftDates.get(where.leagueId) } : null)) },
    tournamentShellGrant: {
      findMany: vi.fn(async ({ where }: { where: { tournamentId: string; canEditSettings?: boolean } }) => db.grants.filter(g => g.tournamentId === where.tournamentId && (where.canEditSettings === undefined || g.canEditSettings === where.canEditSettings)).map(g => ({ ...g }))),
      upsert: vi.fn(async ({ create, update }: { where: unknown; create: { userId: string; tournamentId: string; canEditSettings: boolean }; update: { canEditSettings: boolean } }) => {
        const g = db.grants.find(x => x.userId === create.userId && x.tournamentId === create.tournamentId)
        if (g) Object.assign(g, update); else db.grants.push({ ...create })
      }),
      deleteMany: vi.fn(async ({ where }: { where: { tournamentId: string; userId: string } }) => {
        const before = db.grants.length; db.grants = db.grants.filter(g => !(g.tournamentId === where.tournamentId && g.userId === where.userId)); return { count: before - db.grants.length }
      }),
    },
    league: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const l = db.appLeagues.get(where.id); return l ? { userId: l.userId, settings: structuredClone(l.settings) } : null }),
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => { const l = db.appLeagues.get(where.id); return l ? { userId: l.userId, settings: structuredClone(l.settings) } : null }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { settings: Record<string, unknown> } }) => { db.appLeagues.get(where.id)!.settings = data.settings }),
    },
    leagueTeam: {
      findMany: vi.fn(async ({ where }: { where: { leagueId: string; claimedByUserId: { in: string[] } } }) => db.teams.filter(t => t.leagueId === where.leagueId && t.claimedByUserId && where.claimedByUserId.in.includes(t.claimedByUserId)).map(t => ({ ...t }))),
      findFirst: vi.fn(async ({ where }: { where: { leagueId: string; claimedByUserId: string } }) => db.teams.find(t => t.leagueId === where.leagueId && t.claimedByUserId === where.claimedByUserId) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Team> }) => Object.assign(db.teams.find(t => t.id === where.id)!, data)),
      create: vi.fn(),
    },
    roster: { findFirst: vi.fn(async () => null) },
    appUser: { findFirst: vi.fn(async ({ where }: { where: { username: { equals: string } } }) => db.users.find(u => u.username.toLowerCase() === where.username.equals.toLowerCase()) ?? null) },
    tournamentAuditLog: { create: vi.fn(async ({ data }: { data: { action: string; data: Record<string, unknown> } }) => { db.audits.push(data); return data }) },
  }
  prismaMock.$transaction = vi.fn(async (fn: (t: unknown) => unknown) => fn(prismaMock))
  /** Stand-in for the commissioner's league settings save: writes LeagueSettings.draftDateUtc. */
  const patch = vi.fn(async (userId: string, body: { leagueId: string; draftDateUtc: string }, _opts?: { actingUserId?: string; source?: string }) => {
    if (db.refuse.has(body.leagueId)) return new Response(JSON.stringify({ error: 'Only the commissioner can change league settings.' }), { status: 403 })
    db.draftDates.set(body.leagueId, new Date(body.draftDateUtc))
    return new Response(JSON.stringify({ success: true, userId }), { status: 200 })
  })
  return { db, prismaMock, patch }
})

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/league/execute-league-settings-patch', () => ({ executeLeagueSettingsPatch: (u: string, b: never, o?: never) => (o === undefined ? patch(u, b) : patch(u, b, o)) }))

import { syncConferenceCoCommissioners, syncConferenceDraftTimes } from '@/lib/tournament/divisions/conferenceLeagueSync'
import { getLeagueRole } from '@/lib/league/permissions'
import { TOURNAMENT_CO_COMMISSIONERS_KEY } from '@/lib/league/tournamentCoCommissioners'

const AT = new Date('2026-11-01T23:00:00.000Z')
function conferences(n: number, opts: { draftAt?: Date | null; linked?: boolean } = {}) {
  db.leagues = Array.from({ length: n }, (_, i) => ({ id: `tl${i + 1}`, tournamentId: 't1', name: `Conference ${i + 1}`, leagueNumber: i + 1, leagueId: opts.linked === false ? null : `L${i + 1}`, draftScheduledAt: opts.draftAt === undefined ? AT : opts.draftAt }))
  for (const l of db.leagues) if (l.leagueId) {
    db.sessions.set(l.leagueId, 'pre_draft')
    db.appLeagues.set(l.leagueId, { userId: 'owner', settings: { draft_rounds: 15 } })
    // Two entrants per league hold teams; the owner holds none in this test.
    for (const m of [1, 2]) db.teams.push({ id: `${l.leagueId}-t${m}`, leagueId: l.leagueId, claimedByUserId: `${l.id}-u${m}`, isCommissioner: false, isCoCommissioner: false })
  }
}
const coList = (leagueId: string) => db.appLeagues.get(leagueId)!.settings[TOURNAMENT_CO_COMMISSIONERS_KEY]

beforeEach(() => {
  db.shell = { id: 't1', format: 'divisions', commissionerId: 'owner', status: 'placed', name: 'Cup' }
  db.leagues = []; db.sessions = new Map(); db.draftDates = new Map(); db.grants = []; db.appLeagues = new Map(); db.teams = []; db.audits = []; db.users = []; db.refuse = new Set()
  patch.mockClear()
})

describe('tournament draft times reach the real conference leagues', () => {
  it('schedules every linked league through the commissioner league-settings path', async () => {
    conferences(4)
    const out = await syncConferenceDraftTimes('t1', 'actor')
    expect(out.map(o => o.outcome)).toEqual(['scheduled', 'scheduled', 'scheduled', 'scheduled'])
    expect(patch).toHaveBeenCalledTimes(4)
    // Authorized as the league commissioner (the owner), recorded as whoever set the time, and marked
    // as the tournament's own sync so the league → tournament copy-back does not run.
    expect(patch).toHaveBeenCalledWith('owner', { leagueId: 'L3', draftDateUtc: AT.toISOString() }, { actingUserId: 'actor', source: 'tournament' })
    for (const id of ['L1', 'L2', 'L3', 'L4']) expect(db.draftDates.get(id)?.toISOString()).toBe(AT.toISOString())
    expect(db.audits.filter(a => a.action === 'divisions_draft_times_synced')).toHaveLength(1)
  })

  it('limits to the conference whose time was set, and keeps per-conference times', async () => {
    conferences(3)
    db.leagues[1]!.draftScheduledAt = new Date('2026-11-02T01:00:00.000Z')
    const out = await syncConferenceDraftTimes('t1', 'actor', { tournamentLeagueIds: ['tl2'] })
    expect(out).toHaveLength(1)
    expect(patch).toHaveBeenCalledTimes(1)
    expect(db.draftDates.get('L2')?.toISOString()).toBe('2026-11-02T01:00:00.000Z')
    expect(db.draftDates.has('L1')).toBe(false)
  })

  it('skips and reports a league whose draft already started or finished', async () => {
    conferences(3)
    db.sessions.set('L1', 'in_progress'); db.sessions.set('L3', 'completed')
    const out = await syncConferenceDraftTimes('t1', 'actor')
    expect(out.map(o => [o.leagueId, o.outcome])).toEqual([['L1', 'skipped_started'], ['L2', 'scheduled'], ['L3', 'skipped_started']])
    expect(patch).toHaveBeenCalledTimes(1)
    expect(db.draftDates.has('L1')).toBe(false)
    const audit = db.audits.find(a => a.action === 'divisions_draft_times_synced')!
    expect((audit.data.leagues as Array<{ outcome: string }>).filter(l => l.outcome === 'skipped_started')).toHaveLength(2)
  })

  it('a re-run writes nothing', async () => {
    conferences(3)
    await syncConferenceDraftTimes('t1', 'actor')
    patch.mockClear(); db.audits = []
    const again = await syncConferenceDraftTimes('t1', 'actor')
    expect(again.every(o => o.outcome === 'unchanged')).toBe(true)
    expect(patch).not.toHaveBeenCalled()
    expect(db.audits).toHaveLength(0)
  })

  it('reports a league not set up yet, and a league that refused the time, without stopping the rest', async () => {
    conferences(3)
    db.leagues[0]!.leagueId = null
    db.refuse.add('L2')
    const out = await syncConferenceDraftTimes('t1', 'actor')
    expect(out.map(o => o.outcome)).toEqual(['not_ready', 'failed', 'scheduled'])
    expect(out[1]!.error).toBe('Only the commissioner can change league settings.')
  })
})

describe('tournament co-commissioners are co-commissioners of every conference league', () => {
  it('adds co-commissioners (settings grants only) to every league without giving a seat', async () => {
    conferences(3)
    db.grants = [{ tournamentId: 't1', userId: 'co1', canEditSettings: true }, { tournamentId: 't1', userId: 'viewer1', canEditSettings: false }]
    const teamsBefore = JSON.stringify(db.teams)
    const out = await syncConferenceCoCommissioners('t1', 'owner')
    expect(out.map(o => [o.outcome, o.added])).toEqual([['updated', 1], ['updated', 1], ['updated', 1]])
    for (const id of ['L1', 'L2', 'L3']) {
      expect(coList(id)).toEqual(['co1'])
      expect(db.appLeagues.get(id)!.settings.draft_rounds).toBe(15)
      expect(await getLeagueRole(id, 'co1')).toBe('co_commissioner')
      expect(await getLeagueRole(id, 'viewer1')).toBeNull()
    }
    // No team was created, claimed or flagged for a co-commissioner who entered nothing.
    expect(JSON.stringify(db.teams)).toBe(teamsBefore)
    expect((prismaMock.leagueTeam as { create: ReturnType<typeof vi.fn> }).create).not.toHaveBeenCalled()
  })

  it('flags the team of a co-commissioner who entered that conference, and only that one', async () => {
    conferences(2)
    db.grants = [{ tournamentId: 't1', userId: 'tl1-u2', canEditSettings: true }]
    await syncConferenceCoCommissioners('t1', 'owner')
    expect(db.teams.find(t => t.id === 'L1-t2')!.isCoCommissioner).toBe(true)
    expect(db.teams.filter(t => t.isCoCommissioner)).toHaveLength(1)
    expect(await getLeagueRole('L2', 'tl1-u2')).toBe('co_commissioner')
    expect(await getLeagueRole('L1', 'tl1-u1')).toBe('member')
  })

  it('adds a co-commissioner granted later, and a re-run is a no-op', async () => {
    conferences(2)
    expect((await syncConferenceCoCommissioners('t1', 'owner')).every(o => o.outcome === 'unchanged')).toBe(true)
    expect(db.audits).toHaveLength(0)
    db.grants.push({ tournamentId: 't1', userId: 'co2', canEditSettings: true })
    await syncConferenceCoCommissioners('t1', 'owner')
    expect(coList('L1')).toEqual(['co2'])
    db.audits = []
    const again = await syncConferenceCoCommissioners('t1', 'owner')
    expect(again.every(o => o.outcome === 'unchanged')).toBe(true)
    expect(db.audits).toHaveLength(0)
  })

  it('removes a co-commissioner taken off the tournament, leaving a flag the league set itself', async () => {
    conferences(2)
    db.grants = [{ tournamentId: 't1', userId: 'tl1-u1', canEditSettings: true }, { tournamentId: 't1', userId: 'co1', canEditSettings: true }]
    await syncConferenceCoCommissioners('t1', 'owner')
    db.teams.find(t => t.id === 'L2-t1')!.isCoCommissioner = true // the league's own commissioner chose this one
    db.grants = [{ tournamentId: 't1', userId: 'tl1-u1', canEditSettings: false }] // demoted to viewer: no longer a co-commissioner
    const demoted = db.teams.find(t => t.id === 'L1-t1')!
    demoted.isCoCommissioner = false // the league already took the flag away; a removal must not hand it back
    const out = await syncConferenceCoCommissioners('t1', 'owner')
    expect(out.map(o => o.removed)).toEqual([2, 2])
    expect(coList('L1')).toEqual([]); expect(coList('L2')).toEqual([])
    expect(demoted.isCoCommissioner).toBe(false)
    expect(db.teams.find(t => t.id === 'L2-t1')!.isCoCommissioner).toBe(true)
    expect(await getLeagueRole('L1', 'co1')).toBeNull()
    expect(await getLeagueRole('L1', 'tl1-u1')).toBe('member')
  })

  it('never lists the league owner, and only leagues that exist are touched', async () => {
    conferences(2)
    db.leagues[1]!.leagueId = null
    db.grants = [{ tournamentId: 't1', userId: 'owner', canEditSettings: true }, { tournamentId: 't1', userId: 'co1', canEditSettings: true }]
    const out = await syncConferenceCoCommissioners('t1', 'owner')
    expect(out).toHaveLength(1)
    expect(coList('L1')).toEqual(['co1'])
  })
})
