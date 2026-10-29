// @vitest-environment node
/**
 * The summary route serves Chop Watch (lib/guillotine/chopWatch.ts) to every member: for the current
 * week the live chop line replaces the old danger tiers and the home's scores; for a past week, or when
 * no watch can be built, the summary is exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: vi.fn(), access: vi.fn(), isG: vi.fn(), config: vi.fn(), summary: vi.fn(), escapes: vi.fn(),
  week: vi.fn(), roster: vi.fn(), home: vi.fn(), watch: vi.fn(), commish: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: h.access }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ isGuillotineLeague: h.isG, getGuillotineConfig: h.config }))
vi.mock('@/lib/guillotine/GuillotineWeeklySummaryService', () => ({ buildWeeklySummary: h.summary }))
vi.mock('@/lib/share/guillotineEscape', () => ({ getGuillotineEscapesForUser: h.escapes }))
vi.mock('@/lib/league-specialty/guillotineHome', () => ({ buildGuillotineHomeExtras: h.home }))
vi.mock('@/lib/guillotine/guillotineCurrentWeek', () => ({ resolveGuillotineCurrentWeek: h.week, findViewerRosterId: h.roster }))
vi.mock('@/lib/guillotine/chopWatchLoad', () => ({ loadChopWatch: h.watch }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: h.commish, assertCommissioner: vi.fn() }))
vi.mock('@/lib/guillotine/guillotineAdvancedSettings', () => ({ readGuillotineAdvanced: vi.fn(async () => null), saveGuillotineAdvanced: vi.fn() }))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/leagues/[leagueId]/guillotine/summary/route'

const call = (query = '') =>
  GET(new NextRequest(`https://allfantasy.test/api/leagues/lg1/guillotine/summary${query}`), { params: Promise.resolve({ leagueId: 'lg1' }) })

const OLD_TIERS = [{ rosterId: 'a', displayName: 'A', tier: 'chop_zone', pointsFromChopZone: 0 }]
const LIVE = {
  week: 7, chopCount: 2, chopLine: 71.4,
  dangerTiers: [
    { rosterId: 'b', displayName: 'B', tier: 'safe', pointsFromChopZone: 20 },
    { rosterId: 'a', displayName: 'A', tier: 'chop_zone', pointsFromChopZone: 0 },
  ],
  scores: { a: 71.4, b: 91.4 },
}

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.session.mockResolvedValue({ user: { id: 'u1' } })
  h.access.mockResolvedValue(true)
  h.isG.mockResolvedValue(true)
  h.config.mockResolvedValue({ sport: 'NBA', eliminationStartWeek: 2, eliminationEndWeek: 20, teamsPerChop: 1, tiebreakerOrder: [], dangerMarginPoints: 10, rosterReleaseTiming: 'next_waiver_run' })
  h.summary.mockResolvedValue({ leagueId: 'lg1', weekOrPeriod: 7, recentChopEvents: [], dangerTiers: OLD_TIERS })
  h.escapes.mockResolvedValue([])
  h.week.mockResolvedValue(7)
  h.roster.mockResolvedValue('a')
  h.home.mockResolvedValue({ scores: { a: 999 }, chopped: [], aliveCount: 2 })
  h.commish.mockResolvedValue(false)
})

describe('GET summary — Chop Watch', () => {
  it('the current week: the live chop line replaces the old tiers and scores, for any member', async () => {
    h.watch.mockResolvedValue(LIVE)
    const body = await (await call()).json()
    expect(h.watch).toHaveBeenCalledWith('lg1', 7)
    expect(body.dangerTiers).toEqual(LIVE.dangerTiers)
    expect(body.home.scores).toEqual(LIVE.scores)
    expect(body.home.aliveCount).toBe(2)
    expect(body.chopWatch).toEqual({ live: true, week: 7, chopCount: 2, chopLine: 71.4 })
  })

  it('no watch: the summary is exactly as before', async () => {
    h.watch.mockResolvedValue(null)
    const body = await (await call()).json()
    expect(body.dangerTiers).toEqual(OLD_TIERS)
    expect(body.home.scores).toEqual({ a: 999 })
    expect(body.chopWatch).toBeNull()
  })

  it('a past week is not rebuilt: its chop already settled it', async () => {
    const body = await (await call('?week=5')).json()
    expect(h.watch).not.toHaveBeenCalled()
    expect(body.dangerTiers).toEqual(OLD_TIERS)
  })

  it('a non-member never reaches it', async () => {
    h.access.mockResolvedValue(false)
    expect((await call()).status).toBe(403)
    expect(h.watch).not.toHaveBeenCalled()
  })
})
