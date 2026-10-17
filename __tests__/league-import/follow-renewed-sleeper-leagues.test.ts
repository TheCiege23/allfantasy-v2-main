/**
 * Following a Sleeper league into its next season (Guap, 2026-10-12: "go ahead with league renewal",
 * "import it automatically"). Sleeper mints a new league id each season; nothing used to look forward.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const leagueFindMany = vi.fn()
const profileFindMany = vi.fn()
const teamFindMany = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: (...a: unknown[]) => leagueFindMany(...a) },
    userProfile: { findMany: (...a: unknown[]) => profileFindMany(...a) },
    leagueTeam: { findMany: (...a: unknown[]) => teamFindMany(...a) },
  },
}))

import { followRenewedSleeperLeagues, followsRenewalAutomatically, type RenewalDeps } from '@/lib/league-import/sleeper/followRenewedLeagues'

const NOW = new Date('2027-02-15T12:00:00Z')
const row = (id: string, platformLeagueId: string, userId = 'U1', over: Record<string, unknown> = {}) =>
  ({ id, userId, platformLeagueId, season: 2026, sport: 'NFL', isDynasty: true, ...over })

function deps(leaguesByAccount: Record<string, Array<Record<string, unknown>>>, over: Partial<RenewalDeps> = {}) {
  const d = {
    listUserLeagues: vi.fn(async (id: string) => leaguesByAccount[id] ?? []),
    importLeague: vi.fn(async (l: { league_id?: unknown }) => ({ leagueId: `af-${String(l.league_id)}` })),
    afterImport: vi.fn(async () => {}),
    ...over,
  }
  return d as typeof d & RenewalDeps
}

/** The candidate query returns `candidates`; the "already held" query returns `held`. */
function leagues(candidates: unknown[], held: unknown[] = []) {
  leagueFindMany.mockImplementation(async (args: { where: { status?: string } }) => (args.where.status === 'complete' ? candidates : held))
}

beforeEach(() => {
  for (const f of [leagueFindMany, profileFindMany, teamFindMany]) f.mockReset()
  profileFindMany.mockResolvedValue([{ userId: 'U1', sleeperUserId: '700000000001' }])
  teamFindMany.mockResolvedValue([])
})

describe('followRenewedSleeperLeagues', () => {
  it('in season there is nothing complete: one query, no Sleeper calls', async () => {
    leagues([])
    const d = deps({})
    const out = await followRenewedSleeperLeagues({ deps: d, now: NOW })
    expect(out).toMatchObject({ candidates: 0, sleeperCalls: 0, imported: 0 })
    expect(d.listUserLeagues).not.toHaveBeenCalled()
  })

  it('only fully imported, complete rows from last season on are candidates — never a legacy_summary row', async () => {
    leagues([])
    await followRenewedSleeperLeagues({ deps: deps({}), now: NOW })
    const where = leagueFindMany.mock.calls[0]![0].where
    expect(where).toMatchObject({ platform: 'sleeper', status: 'complete', season: { gte: 2026 } })
    expect(where.OR).toEqual([{ leagueVariant: null }, { leagueVariant: { not: 'legacy_summary' } }])
  })

  it('finds the league whose previous_league_id is ours and imports it for the same user, a season on', async () => {
    leagues([row('A', '111')])
    const d = deps({ '700000000001': [{ league_id: '999', previous_league_id: '111' }, { league_id: '555', previous_league_id: '444' }] })
    const out = await followRenewedSleeperLeagues({ deps: d, now: NOW })
    expect(d.listUserLeagues).toHaveBeenCalledWith('700000000001', 'nfl', 2027)
    expect(d.importLeague).toHaveBeenCalledWith(expect.objectContaining({ league_id: '999' }), 'U1', 2027, 'NFL')
    expect(d.afterImport).toHaveBeenCalledWith({ leagueId: 'af-999', platformLeagueId: '999', userId: 'U1', isDynasty: true })
    expect(out).toMatchObject({ renewalsFound: 1, imported: 1, sleeperCalls: 1 })
  })

  it('one call per account answers every candidate that account is in', async () => {
    leagues([row('A', '111'), row('B', '222')])
    const d = deps({ '700000000001': [{ league_id: '999', previous_league_id: '111' }, { league_id: '888', previous_league_id: '222' }] })
    const out = await followRenewedSleeperLeagues({ deps: d, now: NOW })
    expect(out).toMatchObject({ sleeperCalls: 1, imported: 2 })
  })

  it('a renewal the user already holds — a manual re-import or an earlier fire — is left alone', async () => {
    leagues([row('A', '111')], [{ userId: 'U1', platformLeagueId: '999' }])
    const d = deps({ '700000000001': [{ league_id: '999', previous_league_id: '111' }] })
    const out = await followRenewedSleeperLeagues({ deps: d, now: NOW })
    expect(d.importLeague).not.toHaveBeenCalled()
    expect(out).toMatchObject({ renewalsFound: 1, alreadyFollowed: 1, imported: 0 })
  })

  it('another user holding the same renewal does not stop this user\'s own import', async () => {
    leagues([row('A', '111')], [{ userId: 'U2', platformLeagueId: '999' }])
    const d = deps({ '700000000001': [{ league_id: '999', previous_league_id: '111' }] })
    expect((await followRenewedSleeperLeagues({ deps: d, now: NOW })).imported).toBe(1)
  })

  it('not renewed yet: asked, and nothing points back', async () => {
    leagues([row('A', '111')])
    const out = await followRenewedSleeperLeagues({ deps: deps({ '700000000001': [] }), now: NOW })
    expect(out).toMatchObject({ notRenewedYet: 1, renewalsFound: 0, deferred: 0 })
  })

  it('no linked Sleeper account: the league\'s own members are asked instead', async () => {
    profileFindMany.mockResolvedValue([])
    teamFindMany.mockResolvedValue([{ leagueId: 'A', platformUserId: 'orphan-3' }, { leagueId: 'A', platformUserId: '700000000009' }])
    leagues([row('A', '111')])
    const d = deps({ '700000000009': [{ league_id: '999', previous_league_id: '111' }] })
    const out = await followRenewedSleeperLeagues({ deps: d, now: NOW })
    expect(d.listUserLeagues).toHaveBeenCalledWith('700000000009', 'nfl', 2027)
    expect(out.imported).toBe(1)
  })

  it('nobody to ask: counted, never guessed', async () => {
    profileFindMany.mockResolvedValue([])
    leagues([row('A', '111')])
    const d = deps({})
    const out = await followRenewedSleeperLeagues({ deps: d, now: NOW })
    expect(out).toMatchObject({ noIdentity: 1, sleeperCalls: 0 })
  })

  it('a failed list call is reported and the league waits for the next fire', async () => {
    leagues([row('A', '111')])
    const d = deps({}, { listUserLeagues: vi.fn(async () => { throw new Error('Sleeper 503') }) })
    const out = await followRenewedSleeperLeagues({ deps: d, now: NOW })
    expect(out.errors[0]).toMatch(/Sleeper 503/)
    expect(out).toMatchObject({ deferred: 1, notRenewedYet: 0, imported: 0 })
  })

  it('imports are capped per fire; the rest are found again next fire', async () => {
    leagues([row('A', '111'), row('B', '222'), row('C', '333')])
    const d = deps({ '700000000001': [{ league_id: '9', previous_league_id: '111' }, { league_id: '8', previous_league_id: '222' }, { league_id: '7', previous_league_id: '333' }] })
    const out = await followRenewedSleeperLeagues({ deps: d, now: NOW, maxImports: 2 })
    expect(out).toMatchObject({ imported: 2, deferred: 1 })
  })

  it('a history sync that fails after the import does not undo the import', async () => {
    leagues([row('A', '111')])
    const d = deps({ '700000000001': [{ league_id: '999', previous_league_id: '111' }] }, { afterImport: vi.fn(async () => { throw new Error('backfill down') }) })
    const out = await followRenewedSleeperLeagues({ deps: d, now: NOW })
    expect(out).toMatchObject({ imported: 1, failed: 0 })
    expect(out.errors[0]).toMatch(/backfill down/)
  })
})

describe('followsRenewalAutomatically', () => {
  it('Sleeper only', () => {
    expect(followsRenewalAutomatically('sleeper')).toBe(true)
    expect(followsRenewalAutomatically('Sleeper')).toBe(true)
    for (const p of ['espn', 'yahoo', 'allfantasy', null]) expect(followsRenewalAutomatically(p)).toBe(false)
  })
})
