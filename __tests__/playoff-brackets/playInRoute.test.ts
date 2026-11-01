/**
 * GET /api/commissioner/leagues/[id]/playoff-bracket offers a play-in (lib/playoff-brackets/playIn.ts)
 * for the league's playoff field, and recognises a saved one so its card reads "6 teams + play-in".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ league: vi.fn(), season: vi.fn(), evaluate: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'boss' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/league/execute-league-settings-patch', () => ({ executeLeagueSettingsPatch: vi.fn() }))
vi.mock('@/lib/subscription/FeatureGateService', () => ({ FeatureGateService: class { evaluateUserFeatureAccess = m.evaluate } }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: m.league }, redraftSeason: { findUnique: m.season } } }))

import { GET } from '@/app/api/commissioner/leagues/[leagueId]/playoff-bracket/route'

const league = (over: Record<string, unknown> = {}) => ({
  id: 'L', userId: 'boss', sport: 'NFL', season: 2026, leagueSize: 12, playoffTeams: 6, playoffStartWeek: 15, playoffWeeksPerRound: 1, settings: {}, ...over,
})
const get = async (q = '') => (await GET(new Request(`http://x/api${q}`) as never, { params: Promise.resolve({ leagueId: 'L' }) })).json()

beforeEach(() => {
  vi.clearAllMocks()
  m.season.mockResolvedValue(null)
  m.evaluate.mockResolvedValue({ allowed: true })
})

describe('play-in options', () => {
  it('a six-team field is offered one-spot and two-spot play-ins, each checked against the season', async () => {
    m.league.mockResolvedValue(league())
    const body = await get()
    expect(body.savedPlayIn).toBeNull()
    expect(body.playIn.map((p: { spots: number; seeds: number; games: number[][]; finalWeek: number; fitsSeason: boolean }) => [p.spots, p.seeds, p.games, p.finalWeek, p.fitsSeason])).toEqual([
      [1, 7, [[6, 7]], 18, true],
      [2, 8, [[5, 8], [6, 7]], 18, true],
    ])
  })

  it('a play-in that runs past week 18 is flagged', async () => {
    m.league.mockResolvedValue(league({ playoffStartWeek: 16 }))
    expect((await get()).playIn[0]).toMatchObject({ finalWeek: 19, fitsSeason: false })
  })

  it('a saved play-in is recognised and offered against its own six qualifiers', async () => {
    m.league.mockResolvedValue(league({ playoffTeams: 7, settings: { playoff_bye_plan: [2, 2, 1, 1, 1, 0, 0] } }))
    const body = await get()
    expect(body.savedPlayIn).toEqual({ qualifiers: 6, spots: 1 })
    expect(body.plan).toEqual([2, 2, 1, 1, 1, 0, 0])
    expect(body.playIn.map((p: { seeds: number }) => p.seeds)).toEqual([7, 8])
  })
})
