// @vitest-environment node
/**
 * The weekly award card, folded into /api/share/rivalry-card as `?kind=award` (shareable moments,
 * 2026-09-14): signed-in league members only, a valid award kind, and a card only for an award that
 * exists in the league's synced history. The rivalry card itself is unchanged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ session: vi.fn(), leagueFind: vi.fn(), h2h: vi.fn(), imported: vi.fn(), images: [] as unknown[] }))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findFirst: h.leagueFind } } }))
vi.mock('@/lib/league-history/sleeperH2HService', () => ({ getLeagueH2H: h.h2h }))
vi.mock('@/lib/league-history/importedFactsH2HService', () => ({ getImportedLeagueH2H: h.imported }))
vi.mock('next/og', () => ({
  ImageResponse: class {
    status = 200
    constructor(element: unknown, opts: unknown) {
      h.images.push({ element, opts })
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
  const el = node as { type?: unknown; props?: { children?: unknown } & Record<string, unknown> }
  if (typeof el.type === 'function') return text((el.type as (p: unknown) => unknown)(el.props))
  return text(el.props?.children)
}

const payload = {
  managers: [
    { ownerId: 'me', name: 'TheCiege', teamName: 'Ice Kings FC', avatar: null, byOpponent: [] },
    { ownerId: 'rival', name: 'Gooby', teamName: null, avatar: null, byOpponent: [] },
  ],
  seasons: ['2026'],
  latestWeekAwards: {
    season: '2026',
    week: 2,
    topScore: { ownerId: 'me', points: 162.44, season: '2026', week: 2 },
    lowScore: null,
    narrowEscape: { winnerOwnerId: 'me', loserOwnerId: 'rival', margin: 0.84, season: '2026', week: 2 },
    biggestBlowout: null,
  },
}

beforeEach(() => {
  for (const f of [h.session, h.leagueFind, h.h2h, h.imported]) f.mockReset()
  h.images.length = 0
  h.session.mockResolvedValue({ user: { id: 'u1' } })
  h.leagueFind.mockResolvedValue({ id: 'af-ice', name: 'Ice Kings', platform: 'sleeper', platformLeagueId: 'sl-ice' })
  h.h2h.mockResolvedValue(payload)
})

describe('/api/share/rivalry-card?kind=award', () => {
  it('🛑 renders the award from the league’s own history for a signed-in member', async () => {
    const res = (await GET(req('kind=award&leagueId=af-ice&award=narrowEscape'))) as { status: number }
    expect(res.status).toBe(200)
    expect(h.leagueFind.mock.calls[0][0].where).toEqual({ id: 'af-ice', OR: [{ userId: 'u1' }, { teams: { some: { claimedByUserId: 'u1' } } }] })
    expect(h.h2h).toHaveBeenCalledWith('sl-ice')
    const card = text((h.images[0] as { element: unknown }).element)
    expect(card).toContain('WEEK 2 AWARD')
    expect(card).toContain('NARROW ESCAPE')
    expect(card).toContain('0.8')
    expect(card).toContain('point margin over Gooby')
    expect(card).toContain('TheCiege')
    expect(card).toContain('Ice Kings')
  })

  it('a score award says points', async () => {
    await GET(req('kind=award&leagueId=af-ice&award=topScore'))
    const card = text((h.images[0] as { element: unknown }).element)
    expect(card).toContain('TOP SCORE')
    expect(card).toContain('162.4')
    expect(card).toContain('points')
  })

  it('🛑 signed out is 401; not a member is 404; an unknown kind or missing league is 400', async () => {
    h.session.mockResolvedValue(null)
    expect(((await GET(req('kind=award&leagueId=af-ice&award=topScore'))) as Response).status).toBe(401)
    h.session.mockResolvedValue({ user: { id: 'u1' } })
    expect(((await GET(req('kind=award&leagueId=af-ice&award=mvp'))) as Response).status).toBe(400)
    expect(((await GET(req('kind=award&award=topScore'))) as Response).status).toBe(400)
    h.leagueFind.mockResolvedValue(null)
    const notMember = (await GET(req('kind=award&leagueId=af-ice&award=topScore'))) as Response
    expect(notMember.status).toBe(404)
    // Refused BEFORE any history read: a non-member never triggers a league sync.
    expect(await notMember.json()).toEqual({ error: 'League not found' })
    expect(h.h2h).not.toHaveBeenCalled()
    expect(h.imported).not.toHaveBeenCalled()
    expect(h.images).toHaveLength(0)
  })

  it('🛑 an award that week does not hold is 404, never an empty card', async () => {
    expect(((await GET(req('kind=award&leagueId=af-ice&award=lowScore'))) as Response).status).toBe(404)
    h.h2h.mockResolvedValue(null)
    expect(((await GET(req('kind=award&leagueId=af-ice&award=topScore'))) as Response).status).toBe(404)
    expect(h.images).toHaveLength(0)
  })

  it('imported leagues read their persisted facts, like the rivalry card', async () => {
    h.leagueFind.mockResolvedValue({ id: 'af-espn', name: 'ESPN League', platform: 'espn', platformLeagueId: '99' })
    h.imported.mockResolvedValue(payload)
    expect(((await GET(req('kind=award&leagueId=af-espn&award=topScore'))) as { status: number }).status).toBe(200)
    expect(h.imported).toHaveBeenCalledWith('af-espn')
    expect(h.h2h).not.toHaveBeenCalled()
  })

  it('the rivalry card is unchanged: still needs a and b', async () => {
    expect(((await GET(req('leagueId=af-ice'))) as Response).status).toBe(400)
    const res = (await GET(req('leagueId=af-ice&a=me&b=rival'))) as { status: number }
    expect(res.status).toBe(200)
    expect(text((h.images[0] as { element: unknown }).element)).toContain('RIVALRY RECORD')
  })
})
