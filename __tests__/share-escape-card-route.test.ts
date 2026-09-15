// @vitest-environment node
/**
 * The guillotine escape card, folded into /api/share/rivalry-card as `?kind=escape` (shareable
 * moments, 2026-09-14): your own roster in the league is the access check, the escape must be one
 * that happened that week, and the team name never falls back to an email.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: vi.fn(),
  leagueFind: vi.fn(),
  rosterFind: vi.fn(),
  escapes: vi.fn(),
  names: vi.fn(),
  images: [] as unknown[],
}))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.leagueFind, findFirst: vi.fn() }, roster: { findFirst: h.rosterFind } } }))
vi.mock('@/lib/league-history/sleeperH2HService', () => ({ getLeagueH2H: vi.fn() }))
vi.mock('@/lib/league-history/importedFactsH2HService', () => ({ getImportedLeagueH2H: vi.fn() }))
vi.mock('@/lib/share/guillotineEscape', () => ({ getGuillotineEscapesForUser: h.escapes }))
vi.mock('@/lib/guillotine/rosterDisplayNames', () => ({ resolveRosterDisplayNames: h.names }))
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

beforeEach(() => {
  for (const f of [h.session, h.leagueFind, h.rosterFind, h.escapes, h.names]) f.mockReset()
  h.images.length = 0
  h.session.mockResolvedValue({ user: { id: 'u1' } })
  h.leagueFind.mockResolvedValue({ name: 'Blade League' })
  h.rosterFind.mockResolvedValue({ id: 'r-me' })
  h.escapes.mockResolvedValue([
    { weekOrPeriod: 6, myPoints: 101, chopLine: 99, margin: 2, choppedCount: 1 },
    { weekOrPeriod: 4, myPoints: 93.5, chopLine: 90.3, margin: 3.2, choppedCount: 1 },
  ])
  h.names.mockResolvedValue(new Map([['r-me', 'Ice Kings FC']]))
})

describe('/api/share/rivalry-card?kind=escape', () => {
  it('🛑 renders YOUR escape from that week’s chop', async () => {
    const res = (await GET(req('kind=escape&leagueId=lg1&week=4'))) as { status: number }
    expect(res.status).toBe(200)
    expect(h.rosterFind.mock.calls[0][0].where).toEqual({ leagueId: 'lg1', platformUserId: 'u1' })
    expect(h.escapes).toHaveBeenCalledWith('lg1', 'u1')
    const card = text(h.images[0])
    expect(card).toContain('SURVIVED THE CHOP')
    expect(card).toContain('Week 4 chop')
    expect(card).toContain('+3.2')
    expect(card).toContain('93.5 vs 90.3, the highest score chopped')
    expect(card).toContain('Ice Kings FC')
    expect(card).toContain('Blade League')
  })

  it('a zero margin is the tiebreaker; an unnamed roster is "Your team", never an email', async () => {
    h.escapes.mockResolvedValue([{ weekOrPeriod: 4, myPoints: 90, chopLine: 90, margin: 0, choppedCount: 1 }])
    h.names.mockResolvedValue(new Map())
    await GET(req('kind=escape&leagueId=lg1&week=4'))
    const card = text(h.images[0])
    expect(card).toContain('TIE')
    expect(card).toContain('survived on the tiebreaker')
    expect(card).toContain('Your team')
  })

  it('🛑 signed out 401; a bad week 400; no roster of yours in the league 404 before any escape read', async () => {
    h.session.mockResolvedValue(null)
    expect(((await GET(req('kind=escape&leagueId=lg1&week=4'))) as Response).status).toBe(401)
    h.session.mockResolvedValue({ user: { id: 'u1' } })
    expect(((await GET(req('kind=escape&leagueId=lg1'))) as Response).status).toBe(400)
    expect(((await GET(req('kind=escape&leagueId=lg1&week=0'))) as Response).status).toBe(400)
    expect(((await GET(req('kind=escape&leagueId=lg1&week=2.5'))) as Response).status).toBe(400)
    expect(((await GET(req('kind=escape&week=4'))) as Response).status).toBe(400)
    h.rosterFind.mockResolvedValue(null)
    expect(((await GET(req('kind=escape&leagueId=lg1&week=4'))) as Response).status).toBe(404)
    h.rosterFind.mockResolvedValue({ id: 'r-me' })
    h.leagueFind.mockResolvedValue(null)
    expect(((await GET(req('kind=escape&leagueId=lg1&week=4'))) as Response).status).toBe(404)
    expect(h.escapes).not.toHaveBeenCalled()
    expect(h.images).toHaveLength(0)
  })

  it('🛑 no escape of yours from that week’s chop is 404, never a card', async () => {
    const res = (await GET(req('kind=escape&leagueId=lg1&week=5'))) as Response
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'No escape of yours from that chop' })
    expect(h.images).toHaveLength(0)
  })
})
