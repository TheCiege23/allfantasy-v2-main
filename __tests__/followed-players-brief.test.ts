/**
 * "Since your last visit" + follows (2026-09-14): a player you follow joins the injury
 * comparison even when he is on none of your rosters, marked `followed`; a brief with no
 * follows is unchanged; and follows being unavailable never breaks the brief.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  cacheFind: vi.fn(),
  cacheUpsert: vi.fn(),
  teamFind: vi.fn(),
  rosterFind: vi.fn(),
  playerFind: vi.fn(),
  notifFind: vi.fn(),
  resolveInjuryFacts: vi.fn(),
  listFollows: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: { findUnique: h.cacheFind, upsert: h.cacheUpsert },
    leagueTeam: { findMany: h.teamFind },
    roster: { findMany: h.rosterFind },
    sportsPlayer: { findMany: h.playerFind },
    platformNotification: { findMany: h.notifFind },
  },
}))
vi.mock('@/lib/injuries/injuryReadPort', () => ({ resolveInjuryFacts: h.resolveInjuryFacts }))
vi.mock('@/lib/follows/playerFollows', () => ({ listPlayerFollows: h.listFollows }))

import { diffInjuries, getSinceLastVisit, type VisitMarker } from '@/lib/core-app/sinceLastVisit'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'

const NOW = new Date('2026-09-14T15:00:00Z')
const HOUR = 3_600_000

const follow = (sleeperId: string, name: string, sport = 'NFL') => ({
  sport,
  playerKey: sleeperId,
  externalId: null,
  sleeperId,
  name,
  position: 'RB',
  team: 'DET',
  createdAt: NOW,
})

function markerWith(injuries: Record<string, string | null>): VisitMarker {
  const snap = { takenAt: new Date(NOW.getTime() - 5 * HOUR).toISOString(), standings: {}, injuries }
  return {
    version: 1,
    lastSeenAt: new Date(NOW.getTime() - 5 * HOUR).toISOString(),
    sinceAt: new Date(NOW.getTime() - 30 * HOUR).toISOString(),
    firstVisit: false,
    baseline: snap,
    latest: snap,
  }
}

const facts = (entries: Array<[string, string | null]>) => ({
  byPlayer: new Map(entries.map(([n, status]) => [normalizeMatchName(n), { status, stale: false }])),
  ambiguous: [],
  newestFetchedAt: NOW,
  feedStale: false,
  coverage: { sourceAvailable: true, reason: null },
})

const run = (leagues: Array<{ id: string; name: string; sport?: string }> = []) =>
  getSinceLastVisit({
    userId: 'u1', leagues, recentTrades: [], tradesLimit: 5, now: NOW, recordVisit: false, tradesComplete: true,
  })

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.cacheUpsert.mockResolvedValue({})
  h.notifFind.mockResolvedValue([])
  h.teamFind.mockResolvedValue([])
  h.rosterFind.mockResolvedValue([])
  h.listFollows.mockResolvedValue([])
})

describe('followed players in the brief', () => {
  it('🛑 a followed player on NONE of your rosters: his status change appears, marked followed', async () => {
    h.cacheFind.mockResolvedValue({ data: markerWith({ '9221': 'Questionable' }) })
    h.listFollows.mockResolvedValue([follow('9221', 'Jahmyr Gibbs')])
    h.playerFind.mockResolvedValue([{ sleeperId: '9221', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET' }])
    h.resolveInjuryFacts.mockResolvedValue(facts([['Jahmyr Gibbs', 'Out']]))

    const brief = await run()
    expect(brief?.injuries).toEqual([
      { playerId: '9221', name: 'Jahmyr Gibbs', position: 'RB', from: 'Questionable', to: 'Out', leagues: [], leagueIds: [], followed: true },
    ])
    // No league was needed to look him up.
    expect(h.teamFind).not.toHaveBeenCalled()
  })

  it('a followed player you also roster keeps his leagues and is marked followed', async () => {
    h.cacheFind.mockResolvedValue({ data: markerWith({ '9221': null }) })
    h.listFollows.mockResolvedValue([follow('9221', 'Jahmyr Gibbs')])
    h.teamFind.mockResolvedValue([{ leagueId: 'lg-1', platformUserId: 'su', externalId: '1' }])
    h.rosterFind.mockResolvedValue([{ leagueId: 'lg-1', playerData: { players: ['9221'] } }])
    h.playerFind.mockResolvedValue([{ sleeperId: '9221', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET' }])
    h.resolveInjuryFacts.mockResolvedValue(facts([['Jahmyr Gibbs', 'Doubtful']]))

    const brief = await run([{ id: 'lg-1', name: 'Ice Kings', sport: 'NFL' }])
    expect(brief?.injuries[0]).toMatchObject({ leagues: ['Ice Kings'], followed: true })
  })

  it('🛑 with no follows the injury line has NO followed key — the pre-follows shape', async () => {
    h.cacheFind.mockResolvedValue({ data: markerWith({ '9221': null }) })
    h.teamFind.mockResolvedValue([{ leagueId: 'lg-1', platformUserId: 'su', externalId: '1' }])
    h.rosterFind.mockResolvedValue([{ leagueId: 'lg-1', playerData: { players: ['9221'] } }])
    h.playerFind.mockResolvedValue([{ sleeperId: '9221', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET' }])
    h.resolveInjuryFacts.mockResolvedValue(facts([['Jahmyr Gibbs', 'Out']]))

    const brief = await run([{ id: 'lg-1', name: 'Ice Kings', sport: 'NFL' }])
    expect(brief?.injuries[0]).not.toHaveProperty('followed')
  })

  it('🛑 follows unavailable (or throwing) leave the roster brief intact', async () => {
    h.cacheFind.mockResolvedValue({ data: markerWith({ '9221': null }) })
    h.listFollows.mockRejectedValue(new Error('relation does not exist'))
    h.teamFind.mockResolvedValue([{ leagueId: 'lg-1', platformUserId: 'su', externalId: '1' }])
    h.rosterFind.mockResolvedValue([{ leagueId: 'lg-1', playerData: { players: ['9221'] } }])
    h.playerFind.mockResolvedValue([{ sleeperId: '9221', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET' }])
    h.resolveInjuryFacts.mockResolvedValue(facts([['Jahmyr Gibbs', 'Out']]))

    const brief = await run([{ id: 'lg-1', name: 'Ice Kings', sport: 'NFL' }])
    expect(brief?.injuries).toHaveLength(1)
  })

  it('a follow in another sport, or with no Sleeper id, is not looked up', async () => {
    h.cacheFind.mockResolvedValue({ data: markerWith({}) })
    h.listFollows.mockResolvedValue([follow('wemby', 'Victor Wembanyama', 'NBA'), { ...follow('x', 'No Id'), sleeperId: null }])
    const brief = await run()
    expect(brief).toBeNull()
    expect(h.playerFind).not.toHaveBeenCalled()
  })

  it('diffInjuries still needs a baseline for a followed player', () => {
    const meta = new Map([['9221', { name: 'Jahmyr Gibbs', position: 'RB', leagues: [], followed: true }]])
    expect(diffInjuries(null, { takenAt: 'now', standings: {}, injuries: { '9221': 'Out' } }, meta)).toEqual([])
  })
})
