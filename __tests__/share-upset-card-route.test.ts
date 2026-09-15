// @vitest-environment node
/**
 * The weekly upset card, folded into /api/share/rivalry-card as `?kind=upset` (shareable moments,
 * 2026-09-14): your claimed team is the access check (inside getUpsetForCard), the chance shown is
 * the one saved before kickoff, and a missing upset is a 404, never a card.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: vi.fn(),
  upset: vi.fn(),
  images: [] as unknown[],
}))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/league-history/sleeperH2HService', () => ({ getLeagueH2H: vi.fn() }))
vi.mock('@/lib/league-history/importedFactsH2HService', () => ({ getImportedLeagueH2H: vi.fn() }))
vi.mock('@/lib/share/guillotineEscape', () => ({ getGuillotineEscapesForUser: vi.fn() }))
vi.mock('@/lib/guillotine/rosterDisplayNames', () => ({ resolveRosterDisplayNames: vi.fn() }))
vi.mock('@/lib/share/weeklyUpset', () => ({ getUpsetForCard: h.upset }))
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

const req = (qs: string) => new NextRequest(`https://allfantasy.test/api/share/rivalry-card?${qs}`)
const text = (node: unknown): string => {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  const el = node as { type?: unknown; props?: { children?: unknown } }
  if (typeof el.type === 'function') return text((el.type as (p: unknown) => unknown)(el.props))
  return text(el.props?.children)
}

const UPSET = {
  leagueId: 'af-ice',
  leagueName: 'Ice Kings',
  season: 2026,
  week: 1,
  winProbability: 0.22,
  winChance: '22%',
  pointsFor: 112.4,
  pointsAgainst: 98.1,
  teamName: 'Ice Kings FC',
  opponentName: 'Gooby Gang',
  projectedPoints: 96.3,
  opponentProjectedPoints: 110.8,
}

beforeEach(() => {
  for (const f of [h.session, h.upset]) f.mockReset()
  h.images.length = 0
  h.session.mockResolvedValue({ user: { id: 'u1' } })
  h.upset.mockResolvedValue(UPSET)
})

describe('/api/share/rivalry-card?kind=upset', () => {
  it('🛑 renders YOUR upset win with the chance saved before kickoff', async () => {
    const res = (await GET(req('kind=upset&leagueId=af-ice&season=2026&week=1'))) as { status: number }
    expect(res.status).toBe(200)
    expect(h.upset).toHaveBeenCalledWith('u1', 'af-ice', 2026, 1)
    const card = text(h.images[0])
    expect(card).toContain('UPSET WIN')
    expect(card).toContain('Ice Kings FC')
    expect(card).toContain('Won 112.4–98.1 over Gooby Gang')
    expect(card).toContain('Projected 96.3 vs 110.8')
    expect(card).toContain('22%')
    expect(card).toContain('pre-game win chance')
    expect(card).toContain('2026 · Week 1')
    expect(card).toContain('Odds saved before kickoff')
  })

  it('an opponent with no public name is left out of the score line', async () => {
    h.upset.mockResolvedValue({ ...UPSET, opponentName: null })
    await GET(req('kind=upset&leagueId=af-ice&season=2026&week=1'))
    const card = text(h.images[0])
    expect(card).toContain('Won 112.4–98.1')
    expect(card).not.toContain(' over ')
  })

  it('🛑 signed out 401; a missing league, season or week is 400 before any read', async () => {
    h.session.mockResolvedValue(null)
    expect(((await GET(req('kind=upset&leagueId=af-ice&season=2026&week=1'))) as Response).status).toBe(401)
    h.session.mockResolvedValue({ user: { id: 'u1' } })
    for (const qs of [
      'kind=upset&season=2026&week=1',
      'kind=upset&leagueId=af-ice&week=1',
      'kind=upset&leagueId=af-ice&season=1999&week=1',
      'kind=upset&leagueId=af-ice&season=2026.5&week=1',
      'kind=upset&leagueId=af-ice&season=2026',
      'kind=upset&leagueId=af-ice&season=2026&week=0',
      'kind=upset&leagueId=af-ice&season=2026&week=1.5',
    ]) {
      expect(((await GET(req(qs))) as Response).status, qs).toBe(400)
    }
    expect(h.upset).not.toHaveBeenCalled()
    expect(h.images).toHaveLength(0)
  })

  it('🛑 no upset of yours that week (or no claim in the league) is 404, never a card', async () => {
    h.upset.mockResolvedValue(null)
    const res = (await GET(req('kind=upset&leagueId=af-ice&season=2026&week=1'))) as Response
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'No upset of yours that week' })
    expect(h.images).toHaveLength(0)
  })
})
