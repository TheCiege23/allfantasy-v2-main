// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Prove a Sleeper team is yours, then claim it: a code in your Sleeper team name, read back from
 * Sleeper's public league users. Every refusal, the code's lifetime and attempt cap, the race, and
 * exactly what a successful claim writes.
 */

type Team = { id: string; externalId: string; teamName: string | null; platformUserId: string | null; claimedByUserId: string | null }

const db = vi.hoisted(() => ({
  league: null as null | { id: string; platform: string; platformLeagueId: string; userId: string; name: string },
  teams: [] as Team[],
  members: new Set<string>(),
  managerClaims: [] as Array<{ afUserId: string; teamExternalId: string }>,
  identities: [] as Array<{ id: string; userId: string; platform: string; platformUserId: string }>,
  profiles: [] as Array<{ userId: string; sleeperUserId: string }>,
  cache: new Map<string, { data: unknown; expiresAt: Date }>(),
  rosters: [] as Array<{ id: string; playerData: unknown }>,
  writes: [] as string[],
  updateManyCount: 1,
  priorOtherAccount: false,
  paidOk: true,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/league-finance/joinGate', () => ({
  assertPaidJoinAllowed: vi.fn(async () => (db.paidOk ? { ok: true } : { ok: false, code: 'DUES', message: 'pay' })),
  linkDuesToRoster: vi.fn(async () => undefined),
}))
vi.mock('@/lib/identity/linkedAccounts', () => ({
  findExistingLeagueClaim: vi.fn(async () => (db.priorOtherAccount ? { viaOtherAccount: true } : null)),
}))
vi.mock('@/lib/league-join/sleeperOwnershipFetch', () => ({ fetchSleeperLeagueTeamNames: vi.fn(async () => null) }))

const tx = {
  leagueTeam: {
    updateMany: vi.fn(async ({ data }: { data: { claimedByUserId: string } }) => {
      db.writes.push(`team.claimedBy=${data.claimedByUserId}`)
      return { count: db.updateManyCount }
    }),
  },
  roster: { update: vi.fn(async ({ data }: { data: { platformUserId: string } }) => db.writes.push(`roster.owner=${data.platformUserId}`)) },
  leagueManagerClaim: { create: vi.fn(async () => db.writes.push('managerClaim')) },
  redraftLeagueMember: { upsert: vi.fn(async () => db.writes.push('member')) },
  platformIdentity: {
    findFirst: vi.fn(async ({ where }: { where: { platformUserId: string } }) => db.identities.find((i) => i.platformUserId === where.platformUserId) ?? null),
    update: vi.fn(async () => db.writes.push('identity.update')),
    create: vi.fn(async ({ data }: { data: { userId: string; platformUserId: string } }) => db.writes.push(`identity.create=${data.userId}:${data.platformUserId}`)),
  },
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => db.league) },
    leagueTeam: {
      findFirst: vi.fn(async ({ where }: { where: { externalId?: string; claimedByUserId?: string } }) =>
        where.externalId !== undefined
          ? db.teams.find((t) => t.externalId === where.externalId) ?? null
          : db.teams.find((t) => t.claimedByUserId === where.claimedByUserId) ?? null,
      ),
      findMany: vi.fn(async () => db.teams.filter((t) => !t.claimedByUserId && t.platformUserId)),
    },
    redraftLeagueMember: { findUnique: vi.fn(async ({ where }: { where: { leagueId_userId: { userId: string } } }) => (db.members.has(where.leagueId_userId.userId) ? { id: 'm' } : null)) },
    leagueManagerClaim: {
      findMany: vi.fn(async ({ where }: { where: { OR: Array<{ afUserId?: string; teamExternalId?: string }> } }) =>
        db.managerClaims.filter((c) => where.OR.some((o) => (o.afUserId && c.afUserId === o.afUserId) || (o.teamExternalId && c.teamExternalId === o.teamExternalId))),
      ),
    },
    platformIdentity: {
      findFirst: vi.fn(async ({ where }: { where: { platformUserId: string } }) => db.identities.find((i) => i.platformUserId === where.platformUserId) ?? null),
    },
    userProfile: {
      findFirst: vi.fn(async ({ where }: { where: { sleeperUserId: string; userId: { not: string } } }) =>
        db.profiles.find((p) => p.sleeperUserId === where.sleeperUserId && p.userId !== where.userId.not) ?? null,
      ),
    },
    sportsDataCache: {
      findUnique: vi.fn(async ({ where }: { where: { cacheKey: string } }) => {
        const r = db.cache.get(where.cacheKey)
        return r ? { cacheKey: where.cacheKey, ...r } : null
      }),
      upsert: vi.fn(async ({ where, create }: { where: { cacheKey: string }; create: { data: unknown; expiresAt: Date } }) => {
        db.cache.set(where.cacheKey, { data: create.data, expiresAt: create.expiresAt })
      }),
      update: vi.fn(async ({ where, data }: { where: { cacheKey: string }; data: { data: unknown } }) => {
        const r = db.cache.get(where.cacheKey)!
        db.cache.set(where.cacheKey, { ...r, data: data.data })
      }),
      delete: vi.fn(async ({ where }: { where: { cacheKey: string } }) => {
        db.cache.delete(where.cacheKey)
      }),
    },
    roster: { findMany: vi.fn(async () => db.rosters) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}))

import {
  claimCacheKey,
  MAX_ATTEMPTS,
  newClaimCode,
  startSleeperTeamClaim,
  teamNameCarriesCode,
  verifySleeperTeamClaim,
} from '@/lib/league-join/sleeperOwnershipClaim'

const NOW = new Date('2026-10-12T16:00:00Z')
const names = (m: Record<string, string>) => vi.fn(async () => new Map(Object.entries(m)))

beforeEach(() => {
  db.league = { id: 'L1', platform: 'sleeper', platformLeagueId: 'sl-1', userId: 'importer', name: 'Death Squad' }
  db.teams = [
    { id: 't1', externalId: '1', teamName: 'Hammer Time', platformUserId: 'slp-joe', claimedByUserId: null },
    { id: 't2', externalId: '2', teamName: 'Taken FC', platformUserId: 'slp-sam', claimedByUserId: 'sam' },
  ]
  db.members = new Set(['joe'])
  db.managerClaims = []
  db.identities = []
  db.profiles = []
  db.cache = new Map()
  db.rosters = [{ id: 'r1', playerData: { import: { sourceTeamId: '1' } } }]
  db.writes = []
  db.updateManyCount = 1
  db.priorOtherAccount = false
  db.paidOk = true
})

const start = (over: Partial<{ userId: string; teamExternalId: string }> = {}) =>
  startSleeperTeamClaim({ userId: 'joe', leagueId: 'L1', teamExternalId: '1', now: NOW, ...over })

describe('the code', () => {
  it('reads AF-XXXX with no look-alike characters', () => {
    for (let i = 0; i < 50; i += 1) expect(newClaimCode()).toMatch(/^AF-[A-HJKMNP-Z2-9]{4}$/)
  })
  it('is found in a team name whatever the case, spaces or dashes', () => {
    expect(teamNameCarriesCode('Hammer Time AF-7K2Q', 'AF-7K2Q')).toBe(true)
    expect(teamNameCarriesCode('hammer time af 7k2q', 'AF-7K2Q')).toBe(true)
    expect(teamNameCarriesCode('AF7K2Q', 'AF-7K2Q')).toBe(true)
    expect(teamNameCarriesCode('Hammer Time AF-7K2', 'AF-7K2Q')).toBe(false)
    expect(teamNameCarriesCode('', 'AF-7K2Q')).toBe(false)
    expect(teamNameCarriesCode(null, 'AF-7K2Q')).toBe(false)
  })
})

describe('starting a claim', () => {
  it('hands a member a code for an unclaimed Sleeper team, good for 30 minutes', async () => {
    const out = await start()
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.code).toMatch(/^AF-/)
    expect(new Date(out.expiresAt).getTime() - NOW.getTime()).toBe(30 * 60 * 1000)
    expect(out.teamName).toBe('Hammer Time')
  })

  it('tapping twice gives the same code', async () => {
    const a = await start()
    const b = await start()
    expect(a.ok && b.ok && a.code === b.code).toBe(true)
  })

  it.each([
    ['not a Sleeper league', () => (db.league!.platform = 'espn'), 'not_sleeper'],
    ['not a member', () => db.members.clear(), 'not_member'],
    ['team already claimed', () => (db.teams[0]!.claimedByUserId = 'someone'), 'team_taken'],
    ['a leftover claim row for the team', () => db.managerClaims.push({ afUserId: 'x', teamExternalId: '1' }), 'team_taken'],
    ['you already have a team', () => (db.teams[1]!.claimedByUserId = 'joe'), 'already_has_team'],
    ['team has no Sleeper manager', () => (db.teams[0]!.platformUserId = null), 'team_has_no_manager'],
    ['that Sleeper account is someone else’s here', () => db.identities.push({ id: 'i', userId: 'other', platform: 'sleeper', platformUserId: 'slp-joe' }), 'linked_elsewhere'],
    ['…or in the profile store', () => db.profiles.push({ userId: 'other', sleeperUserId: 'slp-joe' }), 'linked_elsewhere'],
  ])('refuses: %s', async (_label, arrange, reason) => {
    arrange()
    expect(await start()).toEqual({ ok: false, reason })
  })

  it('the importer counts as a member', async () => {
    db.members.clear()
    expect((await start({ userId: 'importer' })).ok).toBe(true)
  })
})

describe('verifying', () => {
  async function codeFor() {
    const out = await start()
    if (!out.ok) throw new Error('start failed')
    return out.code
  }

  it('claims the team when the code is in the manager’s Sleeper team name — and links the account', async () => {
    const code = await codeFor()
    const out = await verifySleeperTeamClaim({ userId: 'joe', leagueId: 'L1', teamExternalId: '1', now: NOW, fetchTeamNames: names({ 'slp-joe': `Hammer Time ${code}` }) })
    expect(out).toEqual({ ok: true, leagueId: 'L1' })
    expect(db.writes).toEqual(['team.claimedBy=joe', 'roster.owner=joe', 'managerClaim', 'member', 'identity.create=joe:slp-joe'])
    expect(db.cache.has(claimCacheKey('L1', '1', 'joe'))).toBe(false)
  })

  it('reads the TEAM’S manager, not anyone carrying the code', async () => {
    const code = await codeFor()
    const out = await verifySleeperTeamClaim({ userId: 'joe', leagueId: 'L1', teamExternalId: '1', now: NOW, fetchTeamNames: names({ 'slp-joe': 'Hammer Time', 'slp-sam': `Taken FC ${code}` }) })
    expect(out).toEqual({ ok: false, reason: 'code_not_found', seenTeamName: 'Hammer Time' })
    expect(db.writes).toEqual([])
  })

  it('says what Sleeper shows when the code is not there yet', async () => {
    await codeFor()
    const out = await verifySleeperTeamClaim({ userId: 'joe', leagueId: 'L1', teamExternalId: '1', now: NOW, fetchTeamNames: names({ 'slp-joe': 'Hammer Time' }) })
    expect(out).toMatchObject({ ok: false, reason: 'code_not_found', seenTeamName: 'Hammer Time' })
  })

  it('no code, or an expired one, is refused before any Sleeper read', async () => {
    const fetchTeamNames = names({})
    expect(await verifySleeperTeamClaim({ userId: 'joe', leagueId: 'L1', teamExternalId: '1', now: NOW, fetchTeamNames })).toEqual({ ok: false, reason: 'no_code' })
    await codeFor()
    const later = new Date(NOW.getTime() + 31 * 60 * 1000)
    expect(await verifySleeperTeamClaim({ userId: 'joe', leagueId: 'L1', teamExternalId: '1', now: later, fetchTeamNames })).toEqual({ ok: false, reason: 'no_code' })
    expect(fetchTeamNames).not.toHaveBeenCalled()
  })

  it(`stops after ${MAX_ATTEMPTS} tries per code`, async () => {
    await codeFor()
    const fetchTeamNames = names({ 'slp-joe': 'Hammer Time' })
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await verifySleeperTeamClaim({ userId: 'joe', leagueId: 'L1', teamExternalId: '1', now: NOW, fetchTeamNames })
    }
    expect(await verifySleeperTeamClaim({ userId: 'joe', leagueId: 'L1', teamExternalId: '1', now: NOW, fetchTeamNames })).toEqual({ ok: false, reason: 'too_many_attempts' })
    expect(fetchTeamNames).toHaveBeenCalledTimes(MAX_ATTEMPTS)
  })

  it('Sleeper not answering is said plainly and claims nothing', async () => {
    await codeFor()
    const out = await verifySleeperTeamClaim({ userId: 'joe', leagueId: 'L1', teamExternalId: '1', now: NOW, fetchTeamNames: vi.fn(async () => null) })
    expect(out).toEqual({ ok: false, reason: 'sleeper_unavailable' })
    expect(db.writes).toEqual([])
  })

  it('a claim that landed meanwhile is never overwritten', async () => {
    const code = await codeFor()
    db.updateManyCount = 0
    const out = await verifySleeperTeamClaim({ userId: 'joe', leagueId: 'L1', teamExternalId: '1', now: NOW, fetchTeamNames: names({ 'slp-joe': code }) })
    expect(out).toEqual({ ok: false, reason: 'team_taken' })
  })

  it('the same seat gates as every other way in: dues, and a second account', async () => {
    const code = await codeFor()
    db.paidOk = false
    expect(await verifySleeperTeamClaim({ userId: 'joe', leagueId: 'L1', teamExternalId: '1', now: NOW, fetchTeamNames: names({ 'slp-joe': code }) })).toEqual({ ok: false, reason: 'payment_required' })
    db.paidOk = true
    db.priorOtherAccount = true
    expect(await verifySleeperTeamClaim({ userId: 'joe', leagueId: 'L1', teamExternalId: '1', now: NOW, fetchTeamNames: names({ 'slp-joe': code }) })).toEqual({ ok: false, reason: 'other_account' })
    expect(db.writes).toEqual([])
  })

  it('a team whose Sleeper manager changed since the code was issued is refused', async () => {
    const code = await codeFor()
    db.teams[0]!.platformUserId = 'slp-new-owner'
    const out = await verifySleeperTeamClaim({ userId: 'joe', leagueId: 'L1', teamExternalId: '1', now: NOW, fetchTeamNames: names({ 'slp-new-owner': code }) })
    expect(out).toEqual({ ok: false, reason: 'no_code' })
  })
})
