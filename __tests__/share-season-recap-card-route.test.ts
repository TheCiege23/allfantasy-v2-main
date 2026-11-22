// @vitest-environment node
/**
 * The season recap share cards, folded into /api/share/rivalry-card as `?kind=season_recap`. One card
 * for the champion and one per award the recap has; an award the recap does not have is a 404, never a
 * blank card. League membership is the access check — the cards are every member's, not AF Commissioner.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: vi.fn(),
  membership: vi.fn(),
  recap: vi.fn(),
  images: [] as unknown[],
}))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: vi.fn(async () => ({ name: 'Sunday Syndicate' })) } } }))
vi.mock('@/lib/league-history/sleeperH2HService', () => ({ getLeagueH2H: vi.fn() }))
vi.mock('@/lib/league-history/importedFactsH2HService', () => ({ getImportedLeagueH2H: vi.fn() }))
vi.mock('@/lib/share/guillotineEscape', () => ({ getGuillotineEscapesForUser: vi.fn() }))
vi.mock('@/lib/guillotine/rosterDisplayNames', () => ({ resolveRosterDisplayNames: vi.fn() }))
vi.mock('@/lib/share/weeklyUpset', () => ({ getUpsetForCard: vi.fn() }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: h.membership }))
vi.mock('@/lib/core-app/leagueStandings', () => ({ getLeagueStandings: vi.fn() }))
vi.mock('@/lib/season-recap/seasonRecapService', () => ({ getSeasonRecap: h.recap }))
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
import { SEASON_RECAP_CARD_AWARDS, seasonRecapCardAwards, seasonRecapCardHref, seasonRecapCardView } from '@/lib/share/seasonRecapCard'
import { RECAP_LEAGUE_ID, RECAP_SEASON, recapFixture } from './season-recap/recapFixture'

const req = (qs: string) => new NextRequest(`https://allfantasy.test/api/share/rivalry-card?${qs}`)
const text = (node: unknown): string => {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  const el = node as { type?: unknown; props?: { children?: unknown } }
  if (typeof el.type === 'function') return text((el.type as (p: unknown) => unknown)(el.props))
  return text(el.props?.children)
}
const cardUrl = (award: string, extra = '') => `kind=season_recap&leagueId=${RECAP_LEAGUE_ID}&season=${RECAP_SEASON}&award=${award}${extra}`

const recap = recapFixture()

beforeEach(() => {
  vi.clearAllMocks()
  h.images.length = 0
  h.session.mockResolvedValue({ user: { id: 'usr-viewer-601' } })
  h.membership.mockResolvedValue({ ok: true, access: { isMember: true } })
  h.recap.mockResolvedValue({ recap, stored: true })
})

describe('season recap share cards', () => {
  it('the fixture has every award, so every card is exercised', () => {
    expect(seasonRecapCardAwards(recap)).toEqual([...SEASON_RECAP_CARD_AWARDS])
  })

  it('the champion card names the champion, the record and the final', async () => {
    const res = (await GET(req(cardUrl('champion')))) as unknown as { status: number }
    expect(res.status).toBe(200)
    const drawn = text(h.images[0])
    expect(drawn).toContain('2026 CHAMPION')
    expect(drawn).toContain('Bears')
    expect(drawn).toContain('2-2')
    expect(drawn).toContain('Beat Aces in the final')
    expect(drawn).toContain('Sunday Syndicate')
    expect(h.recap).toHaveBeenCalledWith(RECAP_LEAGUE_ID, RECAP_SEASON)
  })

  const EXPECTED: Record<string, string[]> = {
    runnerUp: ['RUNNER-UP', 'Aces', 'Lost the final to Bears'],
    topSeed: ['TOP SEED', 'Aces', '3-1'],
    mostPointsFor: ['MOST POINTS FOR', 'Aces', '480.4 pts'],
    highestWeek: ['HIGHEST SINGLE WEEK', 'Aces', '150.3 pts', 'Week 2'],
    biggestBlowout: ['BIGGEST BLOWOUT', 'by 70.2 pts', 'Aces 150.3 - Cats 80.1, week 2'],
    closestGame: ['CLOSEST GAME', 'by 0.5 pts', 'Aces 120.2 - Bears 119.7, week 1'],
    bestTrade: ['BEST TRADE BY VALUE', 'Aces', '+300 value', 'Trade with Cats'],
    worstTrade: ['WORST TRADE BY VALUE', 'Cats', '-300 value', 'Trade with Aces'],
    bestPickup: ['BEST PICKUP', 'Jordan Reed (RB)', '64.2 pts', 'Bears · after the week 1 pickup'],
    mostImproved: ['MOST IMPROVED', 'Aces', '25% to 75%'],
    lowerBracket: ['TOILET BOWL', 'Dogs', 'Lost the final to Cats'],
  }
  for (const [award, parts] of Object.entries(EXPECTED)) {
    it(`renders the ${award} card`, async () => {
      const res = (await GET(req(cardUrl(award)))) as unknown as { status: number }
      expect(res.status).toBe(200)
      const drawn = text(h.images[0])
      for (const p of parts) expect(drawn).toContain(p)
    })
  }

  it('Spanish cards say «reclamo» for a pickup', async () => {
    await GET(req(cardUrl('bestPickup', '&lang=es')))
    const drawn = text(h.images[0])
    expect(drawn).toContain('MEJOR ALTA POR RECLAMO')
    expect(drawn).toContain('tras el reclamo de la semana 1')
    expect(drawn.toLowerCase()).not.toContain('waiver')
  })

  it('an award the recap does not have is a 404, not a blank card', async () => {
    h.recap.mockResolvedValue({ recap: recapFixture({ trades: [], lowerBracketFinal: null }), stored: true })
    const res = (await GET(req(cardUrl('bestTrade')))) as unknown as { status: number }
    expect(res.status).toBe(404)
    expect(h.images).toHaveLength(0)
    expect(seasonRecapCardView(recapFixture({ lowerBracketFinal: null }), 'lowerBracket')).toBeNull()
  })

  it('a non-member gets no card', async () => {
    h.membership.mockResolvedValue({ ok: false, status: 403 })
    const res = (await GET(req(cardUrl('champion')))) as unknown as { status: number }
    expect(res.status).toBe(403)
    expect(h.recap).not.toHaveBeenCalled()
  })

  it('a bad award or season is a 400', async () => {
    expect(((await GET(req(cardUrl('mvp')))) as unknown as { status: number }).status).toBe(400)
    expect(((await GET(req(`kind=season_recap&leagueId=${RECAP_LEAGUE_ID}&award=champion`))) as unknown as { status: number }).status).toBe(400)
  })

  it('the page links each card at this route', () => {
    expect(seasonRecapCardHref(RECAP_LEAGUE_ID, RECAP_SEASON, 'champion', 'es')).toBe(
      `/api/share/rivalry-card?kind=season_recap&leagueId=${RECAP_LEAGUE_ID}&season=${RECAP_SEASON}&award=champion&lang=es`,
    )
  })
})
