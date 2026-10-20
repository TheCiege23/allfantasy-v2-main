/**
 * The older playoff-overrides PUT (`/api/commissioner/leagues/[leagueId]/playoffs`) also writes
 * `championship_length`, so it carries the same refusals as the settings PATCH: not while a season is
 * in its playoffs, and not when the final would end after the season's last week.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findUnique: vi.fn(), update: vi.fn() },
    redraftSeason: { findFirst: vi.fn() },
    redraftPlayoffRound: { findFirst: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'u' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/playoff-defaults/PlayoffConfigResolver', () => ({ getPlayoffConfigForLeague: vi.fn().mockResolvedValue({ ok: true }) }))

import { PUT } from '@/app/api/commissioner/leagues/[leagueId]/playoffs/route'

function put(body: Record<string, unknown>) {
  const req = { json: async () => body } as never
  return PUT(req, { params: Promise.resolve({ leagueId: 'L' }) })
}

let inPlayoffs: boolean

beforeEach(() => {
  vi.clearAllMocks()
  inPlayoffs = false
  m.prisma.league.findUnique.mockResolvedValue({
    id: 'L', sport: 'NFL', settings: { playoff_structure: {} },
    playoffTeams: 4, playoffWeeksPerRound: 1, playoffStartWeek: 16, bestBallMode: false, bbContestId: null,
  })
  m.prisma.redraftSeason.findFirst.mockImplementation(async (args: { where: { status?: string } }) =>
    args.where.status ? (inPlayoffs ? { id: 's1' } : null) : { id: 's1', totalWeeks: 17, playoffStartWeek: 16 },
  )
  m.prisma.redraftPlayoffRound.findFirst.mockResolvedValue(null)
  m.prisma.league.update.mockResolvedValue({})
})

describe('PUT /api/commissioner/leagues/[leagueId]/playoffs — championshipLength', () => {
  it('refuses a final that would end after the season (week 18 of 17) and writes nothing', async () => {
    const res = await put({ championshipLength: 2 })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/week 18/)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })

  it('refuses a change during the playoffs', async () => {
    inPlayoffs = true
    const res = await put({ championshipLength: 2 })
    expect(res.status).toBe(409)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })

  it('saves a length that fits, and the panel\'s 0 ("unset") still saves', async () => {
    expect((await put({ championshipLength: 1 })).status).toBe(200)
    expect((await put({ championshipLength: 0 })).status).toBe(200)
    expect(m.prisma.league.update).toHaveBeenCalledTimes(2)
  })
})
