// @vitest-environment node
/**
 * The standings share card, folded into /api/share/rivalry-card as `?kind=standings`. League membership is
 * the access check — `getLeagueStandings` checks nothing itself — and a league with nothing to rank is a
 * 404, never an empty card.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: vi.fn(),
  membership: vi.fn(),
  standings: vi.fn(),
  images: [] as unknown[],
}))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/league-history/sleeperH2HService', () => ({ getLeagueH2H: vi.fn() }))
vi.mock('@/lib/league-history/importedFactsH2HService', () => ({ getImportedLeagueH2H: vi.fn() }))
vi.mock('@/lib/share/guillotineEscape', () => ({ getGuillotineEscapesForUser: vi.fn() }))
vi.mock('@/lib/guillotine/rosterDisplayNames', () => ({ resolveRosterDisplayNames: vi.fn() }))
vi.mock('@/lib/share/weeklyUpset', () => ({ getUpsetForCard: vi.fn() }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: h.membership }))
vi.mock('@/lib/core-app/leagueStandings', () => ({ getLeagueStandings: h.standings }))
vi.mock('next/og', () => ({
  ImageResponse: class {
    status = 200
    constructor(element: unknown) {
      h.images.push(element)
    }
  },
}))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/share/rivalry-card/route'
import {
  advanceWeek,
  buildStandingsBoard,
  type StandingsRules,
  type WeekSnapshot,
} from '@/lib/core-app/standingsModel'

const req = (qs: string) => new NextRequest(`https://allfantasy.test/api/share/rivalry-card?${qs}`)
const text = (node: unknown): string => {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  const el = node as { type?: unknown; props?: { children?: unknown } }
  if (typeof el.type === 'function') return text((el.type as (p: unknown) => unknown)(el.props))
  return text(el.props?.children)
}

const RULES: StandingsRules = {
  playoffTeams: 2,
  playoffTeamsSource: 'league',
  byes: 0,
  regularSeasonEnd: null,
  tiebreakers: ['points_for', 'head_to_head'],
  tiebreakerSource: 'platform',
  rankIsOfficial: false,
  platformLabel: 'Sleeper',
}

function board() {
  const ids = ['1', '2', '3', '4']
  const snaps: WeekSnapshot[] = [
    advanceWeek(
      null,
      2026,
      1,
      [
        { week: 1, rosterId: '1', matchupId: 1, pointsFor: 130.4, pointsAgainst: 101 },
        { week: 1, rosterId: '2', matchupId: 1, pointsFor: 101, pointsAgainst: 130.4 },
        { week: 1, rosterId: '3', matchupId: 2, pointsFor: 120, pointsAgainst: 99 },
        { week: 1, rosterId: '4', matchupId: 2, pointsFor: 99, pointsAgainst: 120 },
      ],
      ids,
      's1',
    ),
  ]
  return buildStandingsBoard({
    season: 2026,
    snapshots: snaps,
    unplayed: [],
    teams: ids.map((id) => ({ rosterId: id, name: `Team ${id}`, avatarUrl: null, isYou: id === '4', division: null, reported: null })),
    rules: RULES,
  })
}

beforeEach(() => {
  for (const f of [h.session, h.membership, h.standings]) f.mockReset()
  h.images.length = 0
  h.session.mockResolvedValue({ user: { id: 'u1' } })
  h.membership.mockResolvedValue({ ok: true, access: {} })
  h.standings.mockResolvedValue({ available: true, league: { id: 'L1', name: 'Ice Kings', platform: 'sleeper' }, board: board() })
})

describe('/api/share/rivalry-card?kind=standings', () => {
  it('renders the table, the playoff line and YOUR row for a league member', async () => {
    const res = (await GET(req('kind=standings&leagueId=L1'))) as { status: number }
    expect(res.status).toBe(200)
    expect(h.membership).toHaveBeenCalledWith('L1', 'u1')
    expect(h.standings).toHaveBeenCalledWith('L1', 'u1')
    const card = text(h.images[0])
    expect(card).toContain('STANDINGS')
    expect(card).toContain('Ice Kings')
    expect(card).toContain('2026 · through week 1')
    expect(card).toContain('Team 1')
    expect(card).toContain('130.4')
    expect(card).toContain('PLAYOFF LINE — TOP 2')
    expect(card).toContain('Team 4  · YOU')
  })

  it('refuses anyone who is not in the league, before reading the standings', async () => {
    h.membership.mockResolvedValue({ ok: false, reason: 'forbidden', status: 403 })
    const res = (await GET(req('kind=standings&leagueId=L1'))) as { status: number }
    expect(res.status).toBe(403)
    expect(h.standings).not.toHaveBeenCalled()
    expect(h.images).toHaveLength(0)
  })

  it('needs a session and a league id', async () => {
    h.session.mockResolvedValue(null)
    expect(((await GET(req('kind=standings&leagueId=L1'))) as { status: number }).status).toBe(401)
    h.session.mockResolvedValue({ user: { id: 'u1' } })
    expect(((await GET(req('kind=standings'))) as { status: number }).status).toBe(400)
  })

  it('is a 404, never an empty card, when there is nothing to rank yet', async () => {
    h.standings.mockResolvedValue({ available: false, leagueName: 'Ice Kings', history: [], reason: 'nothing scored' })
    const res = (await GET(req('kind=standings&leagueId=L1'))) as { status: number }
    expect(res.status).toBe(404)
    expect(h.images).toHaveLength(0)
  })
})
