/**
 * The survival analysis behind POST /api/guillotine/ai/survival. It returned a fixed 72% for every team; these
 * tests pin that every number now comes from the chop preview, the outlook and the Chop page's odds function,
 * and that the route only answers a member of the league.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSurvivalAnalysis, riskTier } from '@/lib/guillotine/ai/survivalAnalysis'
import { survivalOdds } from '@/lib/guillotine/survivalOutlook'

const row = (rosterId: string, points: number, status = 'safe', margin: number | null = null) => ({ rosterId, name: rosterId, points, status, margin, faabChange: null })
const preview = (over: Record<string, unknown> = {}) =>
  ({
    week: 7,
    outcome: 'chop',
    chopCount: 1,
    chopLine: 60,
    blockers: [],
    rows: [row('a', 120, 'safe', 60), row('b', 110, 'safe', 50), row('c', 100, 'danger', 40), row('d', 60, 'chopped', 0)],
    ...over,
  }) as never
const done = (n: number) => ({ playersLeft: 0, starters: 9, gamesLeft: 0, remainingProjection: n, partial: false })
const left = (players: number, n: number) => ({ playersLeft: players, starters: 9, gamesLeft: players, remainingProjection: n, partial: false })
const outlook = { a: done(0), b: done(0), c: done(0), d: left(3, 90) }

describe('the analysis', () => {
  it('🛑 is not 72%: two teams in one league get two different, real numbers', () => {
    const c = buildSurvivalAnalysis({ rosterId: 'c', preview: preview(), outlook, dangerMarginPoints: 10 })!
    const a = buildSurvivalAnalysis({ rosterId: 'a', preview: preview(), outlook, dangerMarginPoints: 10 })!
    expect(c.survivalProbability).not.toBe(a.survivalProbability)
    expect([c.survivalProbability, a.survivalProbability]).not.toContain(72)
  })

  it('the odds are exactly the Chop page’s: the same function over the same rows', () => {
    const odds = survivalOdds(
      preview().rows.map((r: { rosterId: string; points: number }) => ({ rosterId: r.rosterId, current: r.points, remainingProjection: outlook[r.rosterId as keyof typeof outlook].remainingProjection })),
      1,
    )!
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(buildSurvivalAnalysis({ rosterId: id, preview: preview(), outlook, dangerMarginPoints: 10 })!.survivalProbability).toBe(odds.get(id))
    }
  })

  it('names the finish to beat: the lowest projected finish among the others, plus the danger margin', () => {
    // For C: the others finish A 120, B 110, D 60 + 90 = 150. One chop, so the finish to beat is 110.
    const c = buildSurvivalAnalysis({ rosterId: 'c', preview: preview(), outlook, dangerMarginPoints: 10 })!
    expect([c.currentScore, c.projectedScore, c.projectedChopLine, c.safeScoreTarget]).toEqual([100, 100, 110, 120])
    expect([c.currentChopLine, c.marginAboveLine, c.playersLeft]).toEqual([60, 40, 0])
    expect(c.narrative).toBe(`${c.survivalProbability}% to survive week 7. The projected finish to beat is 110.0; you are projected for 100.0. None of your starters has a game left.`)
  })

  it('the tier follows the chance', () => {
    expect([riskTier(95), riskTier(80), riskTier(79), riskTier(50), riskTier(49), riskTier(20), riskTier(19), riskTier(0)]).toEqual(['SAFE', 'SAFE', 'MODERATE', 'MODERATE', 'DANGER', 'DANGER', 'CRITICAL', 'CRITICAL'])
  })

  it('a number it cannot work out is null, never a stand-in', () => {
    const missing = { ...outlook, b: left(2, null as unknown as number) }
    const c = buildSurvivalAnalysis({ rosterId: 'c', preview: preview(), outlook: missing as never, dangerMarginPoints: 10 })!
    expect([c.survivalProbability, c.riskTier, c.projectedChopLine, c.safeScoreTarget]).toEqual([null, null, null, null])
    expect(c.narrative).toBe('You are 100.0 so far, 40.0 above the chop line. Odds need a projection for every team still playing.')
    const none = buildSurvivalAnalysis({ rosterId: 'c', preview: preview(), outlook: null, dangerMarginPoints: 10 })!
    expect([none.survivalProbability, none.projectedScore, none.playersLeft]).toEqual([null, null, null])
  })

  it('an immune team is safe and told so', () => {
    const p = preview({ rows: [row('a', 120), row('b', 110), row('c', 100), row('d', 60, 'immune')] })
    const d = buildSurvivalAnalysis({ rosterId: 'd', preview: p, outlook, dangerMarginPoints: 10 })!
    expect([d.immune, d.riskTier]).toEqual([true, 'SAFE'])
    expect(d.narrative).toBe('You are immune in week 7: the chop cannot take you.')
  })

  it('a no-chop week says so', () => {
    const d = buildSurvivalAnalysis({ rosterId: 'd', preview: preview({ chopCount: 0 }), outlook, dangerMarginPoints: 10 })!
    expect(d.survivalProbability).toBe(100)
    expect(d.narrative).toBe('There is no chop in week 7.')
  })

  it('a team that is not alive gets nothing', () => {
    expect(buildSurvivalAnalysis({ rosterId: 'zz', preview: preview(), outlook, dangerMarginPoints: 10 })).toBeNull()
  })
})

const h = vi.hoisted(() => ({
  gate: vi.fn(),
  season: vi.fn(),
  member: vi.fn(),
  viewer: vi.fn(),
  preview: vi.fn(),
  outlook: vi.fn(),
  insight: vi.fn(),
}))
vi.mock('@/lib/redraft/ai/requireAfSub', () => ({ requireAfSub: h.gate }))
vi.mock('@/lib/prisma', () => ({ prisma: { guillotineSeason: { findFirst: h.season }, guillotineAIInsight: { create: h.insight } } }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: h.member }))
vi.mock('@/lib/guillotine/guillotineCurrentWeek', () => ({ findViewerRosterId: h.viewer }))
vi.mock('@/lib/guillotine/chopPreviewLoad', () => ({ loadChopPreview: h.preview }))
vi.mock('@/lib/guillotine/survivalOutlookLoad', () => ({ loadSurvivalOutlook: h.outlook }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ getGuillotineConfig: vi.fn(async () => ({ dangerMarginPoints: 10 })) }))

import { POST } from '@/app/api/guillotine/ai/survival/route'

const post = (body: unknown) => POST(new Request('http://localhost/api/guillotine/ai/survival', { method: 'POST', body: JSON.stringify(body) }) as never)

describe('the route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.gate.mockResolvedValue('user-1')
    h.season.mockResolvedValue({ leagueId: 'L' })
    h.member.mockResolvedValue(true)
    h.viewer.mockResolvedValue('c')
    h.preview.mockResolvedValue(preview())
    h.outlook.mockResolvedValue(outlook)
    h.insight.mockResolvedValue({})
  })

  it('answers for the viewer’s own team by default', async () => {
    const res = await post({ seasonId: 'S', scoringPeriod: 7 })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { analysis: { rosterId: string; projectedChopLine: number } }
    expect(body.analysis).toMatchObject({ rosterId: 'c', projectedChopLine: 110 })
    expect(h.insight).toHaveBeenCalledTimes(1)
  })

  it('🛑 someone who is not in the league is told the season does not exist, and nothing is worked out', async () => {
    h.member.mockResolvedValue(false)
    const res = await post({ seasonId: 'S', scoringPeriod: 7, rosterId: 'c' })
    expect(res.status).toBe(404)
    expect(h.preview).not.toHaveBeenCalled()
  })

  it('a season that does not exist reads the same', async () => {
    h.season.mockResolvedValue(null)
    expect((await post({ seasonId: 'nope', scoringPeriod: 7 })).status).toBe(404)
  })

  it('only the week being played', async () => {
    const res = await post({ seasonId: 'S', scoringPeriod: 6 })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('Survival odds are worked out for the week being played, week 7.')
  })

  it('a team that is not alive, and a member with no team who names none', async () => {
    expect((await post({ seasonId: 'S', scoringPeriod: 7, rosterId: 'zz' })).status).toBe(404)
    h.viewer.mockResolvedValue(null)
    expect((await post({ seasonId: 'S', scoringPeriod: 7 })).status).toBe(400)
  })

  it('still needs the paid plan', async () => {
    h.gate.mockResolvedValue(new Response(null, { status: 403 }))
    expect((await post({ seasonId: 'S', scoringPeriod: 7 })).status).toBe(403)
    expect(h.season).not.toHaveBeenCalled()
  })
})
