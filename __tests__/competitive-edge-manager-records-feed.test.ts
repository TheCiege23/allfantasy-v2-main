import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Manager Psychology OS (facts only), 2026-11-20: the league's manager records, as the viewer sees them, read through
 * the `psychology` feed — five minutes per viewer — with membership proved on every call before the cache is read.
 */

vi.mock('server-only', () => ({}))

const membership = vi.fn()
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: membership }))
vi.mock('@/lib/core-app/waivers', () => ({ resolveWaiverRules: vi.fn(async () => null) }))
const nativeHistory = vi.fn()
vi.mock('@/lib/competitive-edge/nativeManagerHistory', () => ({ readNativeHistory: nativeHistory }))

const leagueRead = vi.fn()
const teamsRead = vi.fn()
const rows = new Map<string, Record<string, unknown>>()
const key = (w: { domain_kind_level_scopeKey: Record<string, string> }) => Object.values(w.domain_kind_level_scopeKey).join('/')
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: leagueRead },
    leagueTeam: { findMany: teamsRead },
    domainOsFacts: {
      findUnique: vi.fn(async (a: { where: { domain_kind_level_scopeKey: Record<string, string> } }) => rows.get(key(a.where)) ?? null),
      upsert: vi.fn(async (a: { where: { domain_kind_level_scopeKey: Record<string, string> }; create: Record<string, unknown> }) => {
        rows.set(key(a.where), { ...a.create, capturedAt: new Date() })
        return a.create
      }),
    },
  },
}))

const { loadLeagueManagerRecords } = await import('@/lib/competitive-edge/managerRecordLoader')

const TEAMS = [
  { externalId: 't1', ownerName: 'Avery', teamName: 'Comets', platformUserId: 'p1', claimedByUserId: 'u1' },
  { externalId: 't2', ownerName: 'Blake', teamName: 'Rockets', platformUserId: 'p2', claimedByUserId: 'u2' },
  { externalId: 't3', ownerName: 'Casey', teamName: 'Meteors', platformUserId: 'p3', claimedByUserId: null },
]
const none = { available: false, reason: 'Not on file.' }

beforeEach(() => {
  rows.clear()
  membership.mockReset()
  membership.mockResolvedValue({ ok: true })
  leagueRead.mockReset()
  leagueRead.mockResolvedValue({ id: 'lg1', name: 'Test League', platform: 'allfantasy', platformLeagueId: null, sport: 'NFL', season: 2026 })
  teamsRead.mockReset()
  teamsRead.mockResolvedValue(TEAMS)
  nativeHistory.mockReset()
  nativeHistory.mockResolvedValue({ trades: none, waivers: none, drafts: none })
})

describe('manager records through the psychology feed', () => {
  it('a second manager question inside five minutes is served from the entry — no second build', async () => {
    const a = await loadLeagueManagerRecords({ leagueId: 'lg1', userId: 'u1' })
    const b = await loadLeagueManagerRecords({ leagueId: 'lg1', userId: 'u1' })
    expect(a.available && a.data.records.map((r) => r.manager.name)).toEqual(['Blake', 'Casey'])
    expect(b).toEqual(a)
    expect(leagueRead).toHaveBeenCalledTimes(1)
    expect([...rows.keys()]).toContain('psychology/records/user/u1:lg1')
  })

  it('🛑 membership is proved on every call, before the entry is read', async () => {
    await loadLeagueManagerRecords({ leagueId: 'lg1', userId: 'u1' })
    membership.mockResolvedValue({ ok: false })
    const denied = await loadLeagueManagerRecords({ leagueId: 'lg1', userId: 'u1' })
    expect(denied).toEqual({ available: false, reason: 'Manager records are read only for a league you are in.' })
    expect(membership).toHaveBeenCalledTimes(2)
  })

  it('another viewer gets their own build, never the first viewer’s view', async () => {
    await loadLeagueManagerRecords({ leagueId: 'lg1', userId: 'u1' })
    const other = await loadLeagueManagerRecords({ leagueId: 'lg1', userId: 'u2' })
    expect(other.available && other.data.records.map((r) => r.manager.name)).toEqual(['Avery', 'Casey'])
    expect(other.available && other.data.viewerTeamExternalId).toBe('t2')
    expect(leagueRead).toHaveBeenCalledTimes(2)
  })

  it('a single team’s record and the commissioner’s whole directory still build live', async () => {
    await loadLeagueManagerRecords({ leagueId: 'lg1', userId: 'u1' })
    await loadLeagueManagerRecords({ leagueId: 'lg1', userId: 'u1', teamExternalId: 't3' })
    await loadLeagueManagerRecords({ leagueId: 'lg1', userId: 'u1', includeViewer: true })
    expect(leagueRead).toHaveBeenCalledTimes(3)
  })

  it('an unavailable result is never cached', async () => {
    leagueRead.mockResolvedValue(null)
    const first = await loadLeagueManagerRecords({ leagueId: 'lg1', userId: 'u1' })
    expect(first.available).toBe(false)
    expect(rows.size).toBe(0)
  })

  it('the cached view survives the store’s JSON round-trip unchanged', async () => {
    const live = await loadLeagueManagerRecords({ leagueId: 'lg1', userId: 'u1' })
    const stored = [...rows.values()][0]!.facts
    expect(live.available && JSON.parse(JSON.stringify(live.data))).toEqual(stored)
  })
})
