import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ league: vi.fn(), career: vi.fn(), roster: vi.fn(), matchups: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.league },
  redraftRoster: { findFirst: h.roster }, redraftMatchup: { findMany: h.matchups } } }))
vi.mock('@/lib/core-app/careerRecords', () => ({ loadCareerGames: h.career }))

import { buildLeagueFantasyHistoryContext } from '@/lib/chimmy/leagueFantasyHistoryGrounding'

beforeEach(() => {
  vi.clearAllMocks()
  h.league.mockResolvedValue({ id: 'L1', name: 'Fantasy Hoops', sport: 'NBA', leagueType: 'redraft', settings: {} })
  h.career.mockResolvedValue({ games: [
    { leagueId: 'L1', leagueName: 'Fantasy Hoops', season: 2024, week: 8, myScore: 101, oppScore: 97, result: 'W', oppName: 'Rival' },
    { leagueId: 'L1', leagueName: 'Fantasy Hoops', season: 2023, week: 8, myScore: 90, oppScore: 93, result: 'L', oppName: 'Other' },
    { leagueId: 'L2', leagueName: 'Fantasy Hoops', season: 2024, week: 8, myScore: 150, oppScore: 10, result: 'W', oppName: 'Stranger' },
  ] })
  h.roster.mockResolvedValue({ id: 'R1' })
  h.matchups.mockResolvedValue([])
})

describe('selected-league fantasy history', () => {
  it('shows only played games of the selected league and season', async () => {
    const out = await buildLeagueFantasyHistoryContext({ leagueId: 'L1', userId: 'u1', season: 2024 })
    expect(out).toContain('2024 week 8: W 101.00–97.00 versus Rival')
    expect(out).not.toContain('Stranger')
    expect(out).not.toContain('2023 week 8')
    expect(h.career).toHaveBeenCalledWith('u1', expect.objectContaining({ league: 'fantasy hoops', fromSeason: 2024, toSeason: 2024 }))
  })

  it('labels missing history as a data gap rather than a 0–0 game', async () => {
    h.career.mockResolvedValue({ games: [] })
    const out = await buildLeagueFantasyHistoryContext({ leagueId: 'L1', userId: 'u1', season: 2020 })
    expect(out).toMatch(/data gap/)
    expect(out).not.toContain('0–0')
  })

  it('reports finalized native category history without treating it as points', async () => {
    h.league.mockResolvedValue({ id: 'L1', name: 'Cats', sport: 'NBA', leagueType: 'redraft', platform: 'allfantasy',
      settings: { scoring_mode: 'h2h_category' } })
    h.matchups.mockResolvedValue([{ week: 8, season: { season: 2024 }, homeRosterId: 'R1',
      lineupSnapshots: { categoryMatchup: { aWins: 6, bWins: 3, ties: 0,
        categories: [{ label: 'PTS', aValue: 101, bValue: 97 }] } } }])
    const out = await buildLeagueFantasyHistoryContext({ leagueId: 'L1', userId: 'u1' })
    expect(out).toContain('2024 week 8, categories won 6-3-0 tied: PTS 101.00 vs 97.00')
    expect(out).toContain('not fantasy points')
    expect(h.career).not.toHaveBeenCalled()
  })

  it('does not invent a rotisserie rank from a category snapshot', async () => {
    h.league.mockResolvedValue({ id: 'L1', name: 'Roto', sport: 'NBA', leagueType: 'redraft', platform: 'allfantasy',
      settings: { scoring_mode: 'roto' } })
    h.matchups.mockResolvedValue([{ week: 8, season: { season: 2024 }, homeRosterId: 'R1',
      lineupSnapshots: { categoryMatchup: { categories: [{ label: 'REB', aValue: 70, bValue: 60 }] } } }])
    const out = await buildLeagueFantasyHistoryContext({ leagueId: 'L1', userId: 'u1' })
    expect(out).toContain('2024 week 8: REB 70.00 vs 60.00')
    expect(out).toContain('Rotisserie ranks')
    expect(out).not.toContain('categories won')
  })
})
