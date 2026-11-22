// @vitest-environment node
/**
 * "Your week" for an odd-team native league's leftover team: its bye is not a game, so it had no row
 * — unless the league plays the extra matchup instead, which is a game against the chosen team.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  current: vi.fn(),
  matchups: vi.fn(),
  teams: vi.fn(),
  metadata: vi.fn(),
  games: vi.fn(),
  nativeFirst: vi.fn(),
  nativeMany: vi.fn(),
  rosterFirst: vi.fn(),
  view: vi.fn(),
}))
vi.mock('@/lib/redraft/oddTeamExtraMatchup', () => ({ readExtraMatchupViewForSeason: h.view }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/core-app/currentWeek', () => ({ resolveCurrentWeek: h.current }))
vi.mock('@/lib/core-app/leagueWeekMetadata', () => ({ readLeagueWeekMetadata: h.metadata }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    weeklyMatchup: { findMany: h.matchups },
    leagueTeam: { findMany: h.teams },
    sportsGame: { findMany: h.games },
    redraftMatchup: { findFirst: h.nativeFirst, findMany: h.nativeMany },
    redraftRoster: { findFirst: h.rosterFirst },
  },
}))

import { getWeekAll } from '@/lib/core-app/weekAll'

const NATIVE = { id: 'af-odd', name: 'Odd League', platform: 'allfantasy', platformLeagueId: null }
const PICK = { extraMatchup: { opponentRosterId: 'r2', rule: 'top_scorer', reason: 'top_scorer', scoring: 'leftover_only', basisWeek: 3, decidedAt: 'x' } }
const VIEW = { role: 'leftover', otherRosterId: 'r2', teamName: 'Top Dogs', reason: 'top_scorer', countsForYou: true, yourScore: 120.25, theirScore: 101.5, final: true,
  label: "Extra matchup vs Top Dogs (last week's top scorer)", line: "Extra matchup vs Top Dogs (last week's top scorer) · 120.3–101.5" }

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.games.mockResolvedValue([])
  h.metadata.mockResolvedValue([])
  h.teams.mockResolvedValue([])
  h.matchups.mockResolvedValue([])
  h.nativeFirst.mockResolvedValue({ week: 4, season: { season: 2026 } })
  // First read: games against a manager (none for the leftover). Second: the week's byes.
  h.nativeMany.mockImplementation(async (args: { where: { awayRosterId: unknown } }) =>
    args.where.awayRosterId === null ? [{ leagueId: 'af-odd', seasonId: 's', homeRosterId: 'r1', lineupSnapshots: PICK }] : [])
  h.rosterFirst.mockResolvedValue({ id: 'r1' })
  h.view.mockResolvedValue(VIEW)
})

describe('getWeekAll — the extra matchup', () => {
  it('the leftover team\'s week is its extra game, scored, with the line', async () => {
    const out = await getWeekAll('u1', [NATIVE], { previous: true })
    expect(h.view).toHaveBeenCalledWith({ seasonId: 's', week: 4, redraftRosterId: 'r1' })
    expect(out?.rows).toEqual([expect.objectContaining({ leagueId: 'af-odd', pointsFor: 120.25, pointsAgainst: 101.5, won: true, completed: true, extraMatchupLabel: VIEW.line })])
  })

  it('a bye without a pick, or someone else\'s bye, adds nothing', async () => {
    h.rosterFirst.mockResolvedValue(null)
    expect((await getWeekAll('u1', [NATIVE], { previous: true }))?.rows ?? []).toEqual([])
    h.rosterFirst.mockResolvedValue({ id: 'r1' })
    h.nativeMany.mockImplementation(async (args: { where: { awayRosterId: unknown } }) =>
      args.where.awayRosterId === null ? [{ leagueId: 'af-odd', seasonId: 's', homeRosterId: 'r1', lineupSnapshots: null }] : [])
    expect((await getWeekAll('u1', [NATIVE], { previous: true }))?.rows ?? []).toEqual([])
  })
})
