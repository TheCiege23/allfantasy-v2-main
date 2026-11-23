// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  pair: null as null | { role: 'pro' | 'college'; otherLeagueId: string },
  activity: {} as Record<string, Array<Record<string, unknown>>>,
  fantrax: {} as Record<string, Array<Record<string, unknown>>>,
}))

vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'connor' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => ({ ok: true })) }))
const LEAGUES: Record<string, { id: string; name: string; sport: string; platform: string; platformLeagueId: string }> = {
  peach: { id: 'peach', name: 'Peach Bowl (C2C)', sport: 'NFL', platform: 'sleeper', platformLeagueId: 'sl-1' },
  cream: { id: 'cream', name: 'Cream Bowl', sport: 'NCAAF', platform: 'fantrax', platformLeagueId: 'snap-cream' },
}
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async (q: { where: { id: string } }) => LEAGUES[q.where.id] ?? null),
      findMany: vi.fn(async (q: { where: { id: { in: string[] } } }) => q.where.id.in.map((id) => LEAGUES[id]).filter(Boolean)),
    },
  },
}))
vi.mock('@/lib/core-app/leagueActivity', () => ({
  getLeagueActivity: vi.fn(async (a: { leagueId: string }) => ({ items: h.activity[a.leagueId] ?? [] })),
}))
vi.mock('@/lib/league/collegePro/fantraxActivity', () => ({
  fantraxLeagueMoves: vi.fn(async (snapshotId: string) => h.fantrax[snapshotId] ?? []),
}))
vi.mock('@/lib/league/collegePro/pairLink', async () => {
  const actual = await vi.importActual<typeof import('@/lib/league/collegePro/pairLink')>('@/lib/league/collegePro/pairLink')
  return { halfLabel: actual.halfLabel, pairedLeagueFor: vi.fn(async () => h.pair) }
})

import { GET } from '@/app/api/app/leagues/[leagueId]/chat/moves/route'

const ago = (days: number) => new Date(Date.now() - days * 86_400_000)
const sleeperItem = (id: string, days: number) => ({
  id, kind: 'waiver', occurredAt: ago(days), teamName: 'Connor0488', managerName: 'Connor0488', avatarUrl: null,
  involvedTeams: ['Connor0488'], adds: [], drops: [], bid: 12, picks: [],
})
const fantraxCard = (id: string, days: number) => ({
  id, kind: 'roster_move', occurredAt: ago(days).toISOString(), teamName: 'Connor0488', managerName: null, avatarUrl: null,
  involvedTeams: ['Connor0488'], adds: [], drops: [], bid: null, picks: [], inferred: true,
})

const call = async (leagueId: string, query = '') => {
  const res = await GET(new Request(`http://x/api/app/leagues/${leagueId}/chat/moves${query}`), { params: Promise.resolve({ leagueId }) })
  return (await res.json()) as { moves: Array<{ id: string; league?: { name: string; label: string }; inferred?: boolean }>; leagues?: unknown[] }
}

beforeEach(() => {
  h.pair = { role: 'pro', otherLeagueId: 'cream' }
  h.activity = { peach: [sleeperItem('sl-new', 1), sleeperItem('sl-old', 40)] }
  h.fantrax = { 'snap-cream': [fantraxCard('fx-mid', 3)] }
})

describe('the Activity feed of a paired college + pro league', () => {
  it('franchise scope: both leagues’ moves, newest first, each named by its league', async () => {
    const body = await call('peach', '?scope=franchise')
    expect(body.moves.map((m) => [m.id, m.league?.label, m.league?.name])).toEqual([
      ['sl-new', 'NFL', 'Peach Bowl (C2C)'],
      ['fx-mid', 'College', 'Cream Bowl'], // sl-old is outside the 30-day window
    ])
    expect(body.leagues).toHaveLength(2)
  })

  it('without the scope (league chat) the league keeps its own moves only', async () => {
    const body = await call('peach')
    expect(body.moves.map((m) => m.id)).toEqual(['sl-new'])
    expect(body.leagues).toBeUndefined()
  })

  it('a Fantrax league now shows its own stored moves, inferred', async () => {
    h.pair = null
    const body = await call('cream', '?scope=franchise')
    expect(body.moves).toEqual([expect.objectContaining({ id: 'fx-mid', inferred: true })])
  })
})
