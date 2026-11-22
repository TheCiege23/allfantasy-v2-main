/**
 * Team defense (DEF) stats for the NFL draft pool (2026-11-20): SACK / INT / TD summed from the
 * team's defenders, PA/G from stored regular-season scores, FR through playerFumbleRecoveries (the
 * vendor's games-played echo dropped, the two copies of the count never added).
 */
import { describe, expect, it } from 'vitest'
import { attachTeamDefenseStats, scoreTeamDefenseGames, summarizeTeamDefense } from '@/lib/draft-room/nflTeamDefenseSeason'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { getDraftStatColumnsForSport, getStatValueForDraftPlayer, formatDraftStatDisplay } from '@/lib/draft-room/draftSportStatColumns'
import { mockPoolPhoneStatLine, mockPoolStatCells } from '@/components/mock-draft/MockDraftSleeperRoomClient'

const defenders = [
  { team: 'LAR', stats: { sacks: 23, tackles: 60, interceptions: 1 } },
  // Both copies of one recovery: counted once, not twice.
  { team: 'LAR', stats: { sacks: 7.5, interceptions: 4, interception_touchdowns: 1, fumbles_recoveries: 1, defense_fumble_recoveries: 1 } },
  // The games-played echo: 16 "recoveries" in 16 games with no defensive snaps — dropped.
  { team: 'LAR', gamesPlayed: 16, stats: { sacks: 0, games_played: 16, snap_count_defense: 0, defense_fumble_recoveries: 16 } },
  // 2026-style row with only the team-named field, and real snaps: kept.
  { team: 'LAR', gamesPlayed: 9, stats: { sacks: 0, games_played: 9, snap_count_defense: 410, defense_fumble_recoveries: 2 } },
  { team: 'Los Angeles Rams', stats: { sacks: 2, fumble_return_touchdowns: 1 } }, // a full name meets the code
  { team: 'BUF', stats: { sacks: 4 } },
  { team: null, stats: { sacks: 99 } }, // no team: ignored, never guessed
]
const games = [
  { homeTeam: 'Los Angeles Rams', awayTeam: 'Buffalo Bills', homeScore: 24, awayScore: 17, startTime: '2025-09-07T20:00:00Z' },
  // The same game from a second feed: counted once.
  { homeTeam: 'LAR', awayTeam: 'BUF', homeScore: 24, awayScore: 17, startTime: '2025-09-07T23:00:00Z' },
  { homeTeam: 'Buffalo Bills', awayTeam: 'Los Angeles Rams', homeScore: 30, awayScore: 10, startTime: '2025-09-14T20:00:00Z' },
  { homeTeam: 'Buffalo Bills', awayTeam: 'Miami Dolphins', homeScore: null, awayScore: null, startTime: '2025-09-21T20:00:00Z' }, // unplayed
]

describe('summarizeTeamDefense', () => {
  it('sums defenders by team and takes points allowed per game from the scores', () => {
    const out = summarizeTeamDefense(defenders, games)
    const noPoints = { dst_fantasy_points: null, dst_fantasy_points_per_game: null }
    expect(out.get('LAR')).toEqual({ dst_sacks: 32.5, dst_interceptions: 5, dst_td: 2, dst_fumble_recoveries: 3, ...noPoints, dst_points_allowed_per_game: 23.5, games: 2 })
    expect(out.get('BUF')).toEqual({ dst_sacks: 4, dst_interceptions: 0, dst_td: 0, dst_fumble_recoveries: 0, ...noPoints, dst_points_allowed_per_game: 17, games: 2 })
    expect(out.has('MIA')).toBe(false)
  })
})

describe('attachTeamDefenseStats', () => {
  const byTeam = summarizeTeamDefense(defenders, games)

  it('fills the DEF columns on a defense row and leaves everyone else alone', () => {
    const def = { name: 'Rams D/ST', position: 'DEF', team: 'LAR', display: { stats: { fantasyPointsPerGame: null } } }
    const qb = { name: 'Josh Allen', position: 'QB', team: 'BUF', display: { stats: {} } }
    const [defOut, qbOut] = attachTeamDefenseStats([def, qb], byTeam)
    expect(qbOut).toBe(qb)
    const cols = getDraftStatColumnsForSport('NFL', { position: 'DEF' })
    const shown = Object.fromEntries(cols.map((c) => [c.label, formatDraftStatDisplay(getStatValueForDraftPlayer(defOut as never, c), c)]))
    expect(shown).toEqual({ PTS: '—', AVG: '—', SACK: '32.5', INT: '5', FR: '3', TD: '2', 'PA/G': '23.5' })
  })

  it('a defense whose team is unknown keeps its dashes', () => {
    const def = { position: 'DEF', team: 'XYZ', display: { stats: {} } }
    expect(attachTeamDefenseStats([def], byTeam)[0]).toBe(def)
  })
})

describe('the mock pool row for a defense', () => {
  const row = attachTeamDefenseStats(
    [{ position: 'DEF', team: 'LAR', adp: 150, display: { stats: {} }, nflDraftProjectionSplits: null }],
    summarizeTeamDefense(defenders, games),
  )[0]!

  it('leads with points per game, then SACK, INT and PA/G; a missing AVG is skipped on a phone', () => {
    expect(mockPoolStatCells(row as never, 'NFL').map((c) => `${c.label} ${c.value}`)).toEqual(['AVG —', 'SACK 32.5', 'INT 5', 'PA/G 23.5'])
    expect(mockPoolPhoneStatLine(row as never, 'NFL')).toBe('SACK 32.5 · INT 5')
  })
})

describe('DEF fantasy points, scored game by game', () => {
  // Real Sleeper weekly team lines (player_game_stats, BAL 2025), trimmed to the scored keys.
  const bal1 = { dst_sack: 1, ff: 1, pts_allow: 41, yds_allow: 497, pts_std: -2 }
  const bal2 = { dst_sack: 2, dst_interception: 1, fum_rec: 1, blk_kick: 1, idp_defensive_touchdown: 1, pts_allow: 17, yds_allow: 322, pts_std: 15 }
  const standard = buildLeagueStatScorer({ sport: 'NFL', settings: { sportConfig: { scoringPreset: 'STANDARD' } } })!
  const rows = [
    { playerId: 'BAL', weekOrRound: 1, normalizedStatMap: bal1, statPayload: {} },
    { playerId: 'BAL', weekOrRound: 2, normalizedStatMap: {}, statPayload: bal2 }, // falls back to the raw payload
    { playerId: 'BAL', weekOrRound: 2, normalizedStatMap: bal2, statPayload: {} }, // same week again: once
    { playerId: 'BAL', weekOrRound: 3, normalizedStatMap: { dst_sack: 3 }, statPayload: {} }, // no points allowed: unplayed
  ]

  it("scores each game on its own points-allowed tier with the league's rules", () => {
    const out = scoreTeamDefenseGames(rows, standard).get('BAL')!
    // Week 2 matches Sleeper exactly (15). Week 1 is -3 here and -2 on Sleeper: Sleeper scores a
    // forced fumble, AllFantasy's default does not — the league's own rules are the point.
    expect(out).toEqual({ points: -3 + 15, games: 2 })
  })

  it('fills PTS and AVG on the defense row', () => {
    const byTeam = summarizeTeamDefense([], [], scoreTeamDefenseGames(rows, standard))
    const [def] = attachTeamDefenseStats([{ position: 'DEF', team: 'BAL', display: { stats: {} } }], byTeam)
    const cols = getDraftStatColumnsForSport('NFL', { position: 'DEF' })
    const shown = Object.fromEntries(cols.map((c) => [c.label, formatDraftStatDisplay(getStatValueForDraftPlayer(def as never, c), c)]))
    expect(shown.PTS).toBe('12')
    expect(shown.AVG).toBe('6.0')
  })

  it('a shutout has no points-allowed key on Sleeper lines, and still scores the 0 tier', () => {
    // SEA 2025 week 13 as stored: no pts_allow, played (gp 1). Sleeper total 32 = ours 30 + 2 forced fumbles.
    const sea = { gp: 1, dst_sack: 4, dst_interception: 4, fum_rec: 1, idp_defensive_touchdown: 1, ff: 2, pts_std: 32 }
    expect(scoreTeamDefenseGames([{ playerId: 'SEA', weekOrRound: 13, normalizedStatMap: sea, statPayload: {} }], standard).get('SEA'))
      .toEqual({ points: 30, games: 1 })
    // Not marked played and no points allowed: not a game, not scored.
    expect(scoreTeamDefenseGames([{ playerId: 'SEA', weekOrRound: 14, normalizedStatMap: { dst_sack: 2 }, statPayload: {} }], standard).size).toBe(0)
  })

  it('without a scorer, no points are invented', () => {
    expect(summarizeTeamDefense([], [], null).size).toBe(0)
    const [def] = attachTeamDefenseStats([{ position: 'DEF', team: 'BAL', display: { stats: {} } }], summarizeTeamDefense([], []))
    expect((def as { display: { stats: Record<string, unknown> } }).display.stats.pts).toBeUndefined()
  })
})
