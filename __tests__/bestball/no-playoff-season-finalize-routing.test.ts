/**
 * The finalize route (and the week roller, through the same `finalizeSeasonAndEnterOffseason`) sends a
 * Best Ball league with no playoffs to the cumulative finalize that crowns its season leader — never to
 * the bracket runtime, which would clamp its 0-team bracket up to a two-team final.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const getServerSession = vi.fn()
const findUniqueRedraftSeason = vi.fn()
const findFirstLeague = vi.fn()
const findUniqueLeague = vi.fn()
const finalizeNflRedraftPlayoffRuntimeSeason = vi.fn()
const finalizeRotoSeason = vi.fn()
const enterRedraftOffseason = vi.fn()
const triggerKeeperOffseason = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findUnique: (...args: unknown[]) => findUniqueRedraftSeason(...args) },
    league: {
      findFirst: (...args: unknown[]) => findFirstLeague(...args),
      findUnique: (...args: unknown[]) => findUniqueLeague(...args),
    },
  },
}))
vi.mock('@/lib/playoff-runtime', () => ({
  finalizeNflRedraftPlayoffRuntimeSeason: (...args: unknown[]) => finalizeNflRedraftPlayoffRuntimeSeason(...args),
}))
vi.mock('@/lib/redraft/offseason/RedraftOffseasonService', () => ({
  enterRedraftOffseason: (...args: unknown[]) => enterRedraftOffseason(...args),
}))
vi.mock('@/lib/redraft/offseason/finalizeRotoSeason', () => ({
  finalizeRotoSeason: (...args: unknown[]) => finalizeRotoSeason(...args),
}))
vi.mock('@/lib/keeper/offseasonEngine', () => ({
  triggerKeeperOffseason: (...args: unknown[]) => triggerKeeperOffseason(...args),
}))

import { POST } from '@/app/api/redraft/seasons/finalize/route'

function request(body: unknown) {
  return { json: async () => body } as never
}

const finalizeSuccess = {
  ok: true,
  championRosterId: 'roster-1',
  runnerUpRosterId: 'roster-2',
  finalStandings: [],
  events: [],
  state: { teams: [{ rosterId: 'roster-1', ownerId: 'user-1', displayName: 'Champs' }] },
}

beforeEach(() => {
  vi.clearAllMocks()
  getServerSession.mockResolvedValue({ user: { id: 'commish-1' } })
  findUniqueRedraftSeason.mockResolvedValue({ leagueId: 'league-1' })
  findFirstLeague.mockResolvedValue({ userId: 'commish-1', teams: [] })
  triggerKeeperOffseason.mockResolvedValue(undefined)
})

const noPlayoffBestBall = {
  leagueType: 'best_ball',
  isDynasty: false,
  settings: { league_type: 'best_ball', scoring_mode: 'points', best_ball_settings: { playoffFormat: 'none', playoffTeams: 0, matchupFormat: 'cumulative' } },
}

it('a no-playoff best ball league is finalized by its season leader, not a bracket', async () => {
  findUniqueLeague.mockResolvedValue(noPlayoffBestBall)
  finalizeRotoSeason.mockResolvedValueOnce({ ok: true, format: 'roto', alreadyFinalized: false, championRosterId: 'a', runnerUpRosterId: 'b', finalStandings: [{ rosterId: 'a', teamName: 'Aces', rank: 1, points: 2100, champion: true }, { rosterId: 'b', teamName: 'Bears', rank: 2, points: 1900, champion: false }], events: [] })
  enterRedraftOffseason.mockResolvedValueOnce({ ok: true, snapshotId: 'bb-archive', alreadyInOffseason: false })
  const response = await POST(request({ seasonId: 'bb-season' }))
  expect(response.status).toBe(200)
  expect(finalizeRotoSeason).toHaveBeenCalledWith('bb-season', 'commish-1', undefined)
  expect(finalizeNflRedraftPlayoffRuntimeSeason).not.toHaveBeenCalled()
  expect(enterRedraftOffseason).toHaveBeenCalledWith('bb-season', 'commish-1', { finishOrder: ['a', 'b'] })
})

it('[control] a best ball league with playoffs still goes to its bracket', async () => {
  findUniqueLeague.mockResolvedValue({ ...noPlayoffBestBall, settings: { ...noPlayoffBestBall.settings, best_ball_settings: { playoffFormat: 'bracket', playoffTeams: 6 } } })
  finalizeNflRedraftPlayoffRuntimeSeason.mockResolvedValueOnce({ ...finalizeSuccess, alreadyFinalized: false })
  enterRedraftOffseason.mockResolvedValueOnce({ ok: true, snapshotId: 'bracket', alreadyInOffseason: false })
  await POST(request({ seasonId: 'bb-season' }))
  expect(finalizeNflRedraftPlayoffRuntimeSeason).toHaveBeenCalled()
  expect(finalizeRotoSeason).not.toHaveBeenCalled()
})
