// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  identities: vi.fn(), teams: vi.fn(), games: vi.fn(), upsert: vi.fn(), feed: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  playerIdentityMap: { findMany: m.identities },
  sportsTeam: { findMany: m.teams },
  playerGameStat: { findMany: m.games, upsert: m.upsert },
} }))
vi.mock('@/lib/workers/providers/rollingInsightsRest', () => ({ riFetchRows: m.feed }))

import { collegeBoxDates, ingestCollegeFinalBoxes } from '@/lib/workers/providers/collegeFinalBoxes'
import { COLLEGE_FINAL_BOX_SOURCE, collegeFootballBoxSeason, pickCollegeFootballSeasonLines } from '@/lib/af-projections/collegeBoxSeasonLines'

const now = new Date('2026-11-22T02:00:00Z')
const roster = { rosterId: 'player', name: 'Travis Burgess', riId: '8', acceptedNames: ['Travis Burgess'], dates: ['2026-11-14'] }
const identity = { id: 'registry-id', canonicalName: 'Travis Burgess', currentTeam: 'North Carolina',
  position: 'QB', fantraxId: 'player', cfbdId: null, rollingInsightsId: '8' }

function providerGame(status: string, options: { team?: string; name?: string; attempts?: number; yards?: number } = {}) {
  return {
    game_ID: '20261121-2-1', game_status: status, season: 2026, week: 12,
    season_type: 'Regular Season', game_time: 'Nov 21, 2026 17:41:00 GMT',
    full_box: { away_team: { abbrv: 'UVA' }, home_team: { abbrv: options.team ?? 'UNC' } },
    player_box: { home_team: { '8': { player: options.name ?? 'Travis Burgess', position: 'QB',
      passing_attempts: options.attempts ?? 45, passing_yards: options.yards ?? 354 } } },
  }
}

describe('verified college box ingestion', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    m.identities.mockResolvedValue([identity])
    m.teams.mockResolvedValue([
      { name: 'North Carolina', shortName: 'UNC', externalId: '1', source: 'rolling_insights' },
      { name: 'Virginia', shortName: 'UVA', externalId: '2', source: 'rolling_insights' },
    ])
    m.games.mockResolvedValue([])
  })

  it('includes the current Eastern game day and dated appearances', () => {
    expect(collegeBoxDates([roster], now)).toEqual(['2026-11-21', '2026-11-20', '2026-11-19', '2026-11-14'])
  })

  it('saves genuine final stats and keeps the real provider and registry IDs', async () => {
    m.feed.mockImplementation(async (_, { date }) => ({ rows: date === '2026-11-21' ? [providerGame('Final')] : [] }))
    const result = await ingestCollegeFinalBoxes('NCAAF', 2026, [roster], now)
    expect(result.written).toBe(1)
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({
      playerId: identity.id, gameId: '20261121-2-1', providerPlayerId: '8',
      normalizedStatMap: expect.objectContaining({ gameFinal: true, stats: expect.objectContaining({ passing_yards: 354 }) }),
    }) }))
  })

  it('rejects a live box, a namesake, a wrong school, and an unused player', async () => {
    m.feed.mockResolvedValue({ rows: [providerGame('In Progress'), providerGame('Final', { name: 'Another Player' }),
      providerGame('Final', { team: 'UVA' }), providerGame('Final', { attempts: 0, yards: 0 })] })
    const result = await ingestCollegeFinalBoxes('NCAAF', 2026, [roster], now)
    expect(result.written).toBe(0)
    expect(m.upsert).not.toHaveBeenCalled()
  })
})

const makeBox = (id: string, stats: Record<string, number>, gameFinal = true) => (
  { gameId: id, normalizedStatMap: { stats, gameFinal, seasonType: 'regular' } }
)

describe('college football projection basis', () => {
  it('requires two genuine final appearances and does not count duplicate or live lines', () => {
    const first = makeBox('first', { passing_attempts: 11, passing_yards: 59, sacks: 3 })
    const second = makeBox('second', { passing_attempts: 45, passing_yards: 354, rushing_yards: 106, sacks: 1 })
    expect(collegeFootballBoxSeason(identity, [first, first, makeBox('live', { passing_attempts: 20 }, false)])).toBeNull()
    const season = collegeFootballBoxSeason(identity, [first, first, second])
    expect(season?.verifiedGameIds).toEqual(['first', 'second'])
    expect(season?.regular_season).toMatchObject({ games_played: 2, 'passing.YDS': 413, 'rushing.YDS': 106 })
    expect(season?.regular_season).not.toHaveProperty(['defensive.SACKS'])
    expect(collegeFootballBoxSeason(identity, [second, first])?.verifiedBoxVersion).toBe(season?.verifiedBoxVersion)
  })

  it('keeps one season basis and prefers CFBD at equal coverage', () => {
    const make = (source: string, games: number) => ({ playerId: 'one', source, stats: { regular_season: { games_played: games } } })
    const primary = make('cfbd', 1)
    const fallback = make(COLLEGE_FINAL_BOX_SOURCE, 2)
    expect(pickCollegeFootballSeasonLines([primary, fallback])).toEqual([fallback])
    expect(pickCollegeFootballSeasonLines([fallback, make('cfbd', 2)])).toEqual([make('cfbd', 2)])
  })
})
