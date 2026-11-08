// @vitest-environment node
/**
 * A public ESPN league joined by picking a team is OWNED by the AllFantasy system account. Code that
 * read `League.userId` as "the person who runs this league" broke for its members and for the member
 * who later PROVED they are its commissioner. Each block below covers one such path:
 * notifications, plan checks, the review flag, owner-only lists, and reputation.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const SYSTEM = 'allfantasy-system-league-owner'

const db = vi.hoisted(() => ({
  leagues: [] as Array<Record<string, any>>,
  teams: [] as Array<Record<string, any>>,
  claims: [] as Array<Record<string, any>>,
  rosters: [] as Array<Record<string, any>>,
  lastLeagueWhere: null as any,
}))

function matches(row: Record<string, any>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as any[]).some((w) => matches(row, w))
    if (k === 'AND') return (v as any[]).every((w) => matches(row, w))
    const actual = row[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('not' in v) return actual !== v.not
      if ('in' in v) return v.in.includes(actual)
      if ('some' in v) {
        const kids = k === 'teams' ? db.teams.filter((t) => t.leagueId === row.id) : []
        return kids.some((t) => matches(t, v.some))
      }
    }
    return actual === v
  })
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findMany: vi.fn(async ({ where }: any) => {
        db.lastLeagueWhere = where
        return db.leagues.filter((l) => matches(l, where ?? {}))
      }),
      findUnique: vi.fn(async ({ where }: any) => db.leagues.find((l) => l.id === where.id) ?? null),
      findFirst: vi.fn(async ({ where }: any) => db.leagues.find((l) => matches(l, where ?? {})) ?? null),
    },
    leagueTeam: {
      findMany: vi.fn(async ({ where }: any) => db.teams.filter((t) => matches(t, where))),
    },
    leagueManagerClaim: {
      findFirst: vi.fn(async ({ where }: any) => db.claims.find((c) => matches(c, where)) ?? null),
    },
    roster: { findMany: vi.fn(async ({ where }: any) => db.rosters.filter((r) => matches(r, where))) },
    appUser: { findUnique: vi.fn(async () => ({ email: 'x@example.com', username: 'x' })) },
  },
}))
// ESPN roster ids are SWIDs: the real resolver translates only AF and Sleeper ids, so it drops them.
vi.mock('@/lib/notifications/resolveAppUserIds', () => ({
  resolveAppUserIds: vi.fn(async (ids: string[]) => ids.filter((id) => !id.startsWith('{'))),
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn(async () => ({})) }))
const isCommissionerMock = vi.hoisted(() => vi.fn(async () => false))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: isCommissionerMock }))
vi.mock('@/lib/entitlements/afCommissionerPlan', () => ({
  hasAfCommissionerPlan: vi.fn(async ({ id }: { id: string }) => id === 'carol'),
}))

import { getLeagueMemberAppUserIds } from '@/lib/draft-notifications/DraftNotificationService'
import { leagueCommissionerAccountId } from '@/lib/commissioner/leagueCommissionerAccount'
import { runScheduledAiCommissionerAlerts } from '@/lib/ai-commissioner/scheduledAlertsBatch'

function seedSystemLeague() {
  db.leagues.push({
    id: 'L-sys',
    userId: SYSTEM,
    sport: 'NFL',
    settings: {},
    leagueAiCommissionerAlerts: true,
    lifecycleState: 'in_season',
  })
  db.teams.push(
    { leagueId: 'L-sys', externalId: '1', claimedByUserId: 'carol', isCommissioner: true, isCoCommissioner: false },
    { leagueId: 'L-sys', externalId: '2', claimedByUserId: 'alice', isCommissioner: false, isCoCommissioner: false },
    { leagueId: 'L-sys', externalId: '3', claimedByUserId: null, isCommissioner: false, isCoCommissioner: false },
  )
  db.rosters.push(
    { leagueId: 'L-sys', platformUserId: '{SWID-CAROL}' },
    { leagueId: 'L-sys', platformUserId: '{SWID-ALICE}' },
  )
}

beforeEach(() => {
  db.leagues = []
  db.teams = []
  db.claims = []
  db.rosters = []
  db.lastLeagueWhere = null
})

describe('notifications reach the people in a system-owned league', () => {
  it('members come from claimed teams (ESPN roster ids are SWIDs nobody can address)', async () => {
    seedSystemLeague()
    expect((await getLeagueMemberAppUserIds('L-sys')).sort()).toEqual(['alice', 'carol'])
  })

  it('never the system account, even if it shows up as a claimant', async () => {
    seedSystemLeague()
    db.teams[2].claimedByUserId = SYSTEM
    expect(await getLeagueMemberAppUserIds('L-sys')).not.toContain(SYSTEM)
  })
})

describe('leagueCommissionerAccountId', () => {
  it('is the owner for an ordinary league', async () => {
    expect(await leagueCommissionerAccountId('L-x', 'dana')).toBe('dana')
  })

  it("is the PROVEN commissioner of a system-owned league", async () => {
    seedSystemLeague()
    db.claims.push({ leagueId: 'L-sys', afUserId: 'carol', teamExternalId: '1', isConfirmed: true })
    expect(await leagueCommissionerAccountId('L-sys', SYSTEM)).toBe('carol')
  })

  it('is NOBODY when the commissioner team is held by an unconfirmed claim', async () => {
    seedSystemLeague()
    db.claims.push({ leagueId: 'L-sys', afUserId: 'carol', teamExternalId: '1', isConfirmed: false })
    expect(await leagueCommissionerAccountId('L-sys', SYSTEM)).toBeNull()
  })

  it('is nobody when no team is flagged commissioner', async () => {
    seedSystemLeague()
    db.teams[0].isCommissioner = false
    db.claims.push({ leagueId: 'L-sys', afUserId: 'carol', teamExternalId: '1', isConfirmed: true })
    expect(await leagueCommissionerAccountId('L-sys', SYSTEM)).toBeNull()
  })
})

describe("paid commissioner features read the proven commissioner's plan", () => {
  it('runs scheduled AI alerts for a system-owned league whose proven commissioner pays', async () => {
    seedSystemLeague()
    db.claims.push({ leagueId: 'L-sys', afUserId: 'carol', teamExternalId: '1', isConfirmed: true })
    const run = vi.fn(async () => ({ createdAlerts: [] }))
    const res = await runScheduledAiCommissionerAlerts({ run: run as any })
    expect(res).toMatchObject({ ran: 1, skippedNoPlan: 0 })
  })

  it('skips it when the commissioner is only an unconfirmed pick', async () => {
    seedSystemLeague()
    db.claims.push({ leagueId: 'L-sys', afUserId: 'carol', teamExternalId: '1', isConfirmed: false })
    const run = vi.fn()
    const res = await runScheduledAiCommissionerAlerts({ run: run as any })
    expect(res).toMatchObject({ ran: 0, skippedNoPlan: 1 })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('source guards — the fixes cannot quietly come back', () => {
  const repo = path.resolve(__dirname, '..', '..')
  const read = (rel: string) => readFileSync(path.join(repo, rel), 'utf8')

  it('no commissioner route compares the league owner with the session user directly', async () => {
    const { spawnSync } = await import('node:child_process')
    const grep = (pattern: string) =>
      spawnSync('git', ['grep', '-nE', pattern, '--', 'app/api/commissioner'], { cwd: repo, encoding: 'utf8' })
    // `git grep` exits 1 for "no match" (the pass), 0 for matches, anything else is not a verdict.
    const res = grep('league\\.userId (!==|===) session\\.user\\.id')
    expect(res.status).toBe(1)
    expect(res.stdout).toBe('')
    // Positive control: the same instrument DOES see a pattern that is present in those files.
    const control = grep('isOwnerOrLeagueCommissioner\\(league, leagueId, session\\.user\\.id\\)')
    expect(control.status).toBe(0)
    expect(control.stdout.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(40)
  }, 30_000)

  it('…and the shared check is what replaced it (positive control: the routes are real)', () => {
    const src = read('app/api/commissioner/leagues/[leagueId]/nfl-scoring/route.ts')
    expect(src).toContain('await isOwnerOrLeagueCommissioner(league, leagueId, session.user.id)')
  })

  it('isOwnerOrLeagueCommissioner: owner at no cost, a proven commissioner via the shared rule, fails closed', async () => {
    const { isOwnerOrLeagueCommissioner } = await import('@/lib/commissioner/leagueCommissionerAccount')
    const spy = isCommissionerMock
    spy.mockClear()
    spy.mockResolvedValueOnce(true)
    expect(await isOwnerOrLeagueCommissioner({ userId: 'dana' }, 'L', 'dana')).toBe(true)
    expect(spy).not.toHaveBeenCalled()
    expect(await isOwnerOrLeagueCommissioner({ userId: SYSTEM }, 'L', 'carol')).toBe(true)
    spy.mockRejectedValueOnce(new Error('db down'))
    expect(await isOwnerOrLeagueCommissioner({ userId: SYSTEM }, 'L', 'mallory')).toBe(false)
    expect(await isOwnerOrLeagueCommissioner({ userId: 'dana' }, 'L', null)).toBe(false)
  })

  it('owner-only lists also accept a claimed team', () => {
    for (const rel of ['app/api/dashboard/home/signals/route.ts', 'app/api/ai-features/route.ts']) {
      expect(read(rel)).toMatch(/teams: \{ some: \{ claimedByUserId:/)
    }
  })
})
