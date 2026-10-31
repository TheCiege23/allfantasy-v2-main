/**
 * A manager with two teams in one Fantrax league: discovery offers BOTH, each as its own import.
 *
 * `getLeagues` (Secret ID) names every team the holder owns. Discovery took `teamNames[0]`, so the
 * second team never appeared and could not be imported at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireVerifiedUser: vi.fn(),
  getFantraxLeagues: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { deletedLeagueTombstone: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) } },
}))
vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: h.requireVerifiedUser }))
vi.mock('@/lib/league-sync-core', () => ({ getDecryptedAuth: vi.fn(async () => ({ apiKey: 'secret-id' })) }))
vi.mock('@/lib/league-import/fantrax/fantraxApi', () => ({ getFantraxLeagues: h.getFantraxLeagues }))

async function discover() {
  const { POST } = await import('@/app/api/leagues/import/discover/route')
  const res = await POST(
    new Request('http://localhost/api/leagues/import/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'fantrax' }),
    }) as never,
  )
  return { status: res.status, body: (await res.json()) as { leagues: Array<{ sourceId: string; name: string; fantraxLeagueId: string }> } }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireVerifiedUser.mockResolvedValue({ ok: true, userId: 'u1' })
})

describe('Fantrax Secret ID discovery', () => {
  it('offers every team the account owns in a league, each named after its team', async () => {
    h.getFantraxLeagues.mockResolvedValue({
      ok: true,
      data: [
        { leagueId: 'L1', leagueName: 'Road To Glory NCAA Football', teamIds: ['t1', 't2'], teamNames: ['Ciege Tigers', 'Ciege Hawks'] },
        { leagueId: 'L2', leagueName: 'Dynasty One', teamIds: ['t9'], teamNames: ['Ciege Tigers'] },
      ],
    })
    const { status, body } = await discover()
    expect(status).toBe(200)
    expect(body.leagues.map((l) => [l.sourceId, l.name])).toEqual([
      ['fantrax-league:L1|Ciege Tigers', 'Road To Glory NCAA Football — Ciege Tigers'],
      ['fantrax-league:L1|Ciege Hawks', 'Road To Glory NCAA Football — Ciege Hawks'],
      // One team: the league's own name, exactly as before.
      ['fantrax-league:L2|Ciege Tigers', 'Dynasty One'],
    ])
    // Both teams are the same league for the deleted-league check.
    expect(body.leagues.slice(0, 2).map((l) => l.fantraxLeagueId)).toEqual(['L1', 'L1'])
  })

  it('a league with no team names is still offered once', async () => {
    h.getFantraxLeagues.mockResolvedValue({ ok: true, data: [{ leagueId: 'L3', leagueName: 'Bare', teamIds: [], teamNames: [] }] })
    const { body } = await discover()
    expect(body.leagues.map((l) => [l.sourceId, l.name])).toEqual([['fantrax-league:L3', 'Bare']])
  })

  it('a team name listed twice is offered once', async () => {
    h.getFantraxLeagues.mockResolvedValue({ ok: true, data: [{ leagueId: 'L4', leagueName: 'Dup', teamIds: ['a', 'a'], teamNames: ['Same', ' Same '] }] })
    const { body } = await discover()
    expect(body.leagues.map((l) => l.sourceId)).toEqual(['fantrax-league:L4|Same'])
  })
})
